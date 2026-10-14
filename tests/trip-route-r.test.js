// R. 일정 주소·경유지 테스트 (가짜 Firestore/Auth):
//  일정 만들기·수정 창의 캠핑장 주소·경유지(더하기·빼기·순서·5곳까지), 저장·비우면 필드 삭제,
//  일정 패널 주소 줄(경유지 없으면 바로 복사, 있으면 순서대로 보여 주는 창·각각/전체 복사), Home 다음 캠핑 주소 줄, 그룹 멤버에게도 보임, 주소 없는 일정은 그대로
// 실행: node tests/trip-route-r.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick, gearAction } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-router-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8784;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };


const server = {};
(function seed() {
  const A = 'users/uidAlice/', G = 'groups/grpFam';
  const mem = (n, r) => ({ name: n, photoURL: '', role: r });
  server[A + 'settings/app'] = { gearCategories: [], homeWidgets: { nextTrip: true, camping: true, checklist: true } };
  server[A + 'trips/old'] = { title: '예전 일정', startDate: ymd(20), endDate: ymd(21), campsiteName: '가평', region: '가평', createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  server[A + 'checklists/ol'] = { title: '예전 준비물', tripId: 'old', items: [{ id: 'x1', label: '텐트', status: 'pending', group: '기타' }] };
  server[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob'], createdAt: '1', gearCategories: [],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member') } };
})();

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });
  await sleep(700);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const pages = [];
  async function phone(user, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
    await ctx.exposeFunction('__fsDump', () => JSON.parse(JSON.stringify(server)));
    await ctx.exposeFunction('__fsWrite', async (p, d) => {
      if (d === null) delete server[p]; else server[p] = d;
      for (const pg of pages) { if (!pg.isClosed()) pg.evaluate(([p2, d2]) => window.__fsApply && window.__fsApply(p2, d2), [p, d]).catch(() => {}); }
    });
    await ctx.addInitScript(u => { window.__fakePopupUser = u; }, user);
    // 클립보드: 복사한 글을 기억(진짜 클립보드 대신)
    await ctx.addInitScript(() => { window.__copied = []; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => { window.__copied.push(t); return Promise.resolve(); } } }); });
    await ctx.addInitScript(FAKE);
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('NATIVE DIALOG'); d.dismiss(); });
    pages.push(page);
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForSelector('#login-btn:not([disabled])', { timeout: 6000 });
    await page.click('[data-action="login-google"]');
    await page.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
    await sleep(300);
    return page;
  }
  const settle = () => sleep(350);
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const copied = p => p.evaluate(() => window.__copied.slice());
  const tripBy = (base, title) => { const e = Object.entries(server).find(([k, v]) => k.startsWith(base + 'trips/') && v.title === title); return e ? { id: e[0].split('/').pop(), ...e[1] } : null; };
  const A = 'users/uidAlice/', G = 'groups/grpFam/';

  const D = await phone(UA);
  await nav(D, 'checklist'); await settle();
  // ================= 1. 일정 만들기: 주소·경유지 =================
  await D.click('[data-action="trip-new"]'); await settle();
  check('1 일정 만들기 창에 캠핑장 주소 칸 + 안내 + 경유지 추가 버튼', await D.locator('#tf-address').count() === 1 && /네비게이션에 붙여넣을 수 있어요/.test(await D.locator('#modal-root').innerText())
    && await D.locator('[data-action="tf-wp-add"]').isVisible() && await D.locator('#tf-wps .tf-wp').count() === 0);
  await D.fill('#tf-title', '홍천 가을 캠핑'); await D.fill('#tf-start', ymd(3)); await D.fill('#tf-end', ymd(4));
  await D.fill('#tf-campsite', '홍천 강변 캠핑장');
  await D.fill('#tf-address', '강원 홍천군 서면 마곡길 123');
  await D.click('[data-action="tf-wp-add"]');
  check('1 경유지 추가 → 줄이 생기고 그 칸에 초점', await D.locator('#tf-wps .tf-wp').count() === 1 && await D.evaluate(() => document.activeElement && document.activeElement.classList.contains('tf-wp')));
  await D.keyboard.type('하나로마트 홍천점');
  await D.click('[data-action="tf-wp-add"]'); await D.keyboard.type('지울 경유지');
  await D.click('[data-action="tf-wp-add"]'); await D.keyboard.type('홍천 정육점');
  check('1 경유지 줄 번호(경유 1·2·3)', JSON.stringify(await D.locator('#tf-wps .tf-wp-no').allInnerTexts()) === JSON.stringify(['경유 1', '경유 2', '경유 3']));
  await D.click('#tf-wps .tf-wp-row:nth-child(2) [data-action="tf-wp-del"]');
  check('1 가운데 경유지 빼기 → 나머지는 순서·값 그대로, 번호 다시 매김', JSON.stringify(await D.locator('#tf-wps .tf-wp').evaluateAll(els => els.map(e => e.value))) === JSON.stringify(['하나로마트 홍천점', '홍천 정육점'])
    && JSON.stringify(await D.locator('#tf-wps .tf-wp-no').allInnerTexts()) === JSON.stringify(['경유 1', '경유 2']) && (await D.inputValue('#tf-title')) === '홍천 가을 캠핑');
  for (let i = 0; i < 3; i++) await D.click('[data-action="tf-wp-add"]');
  check('1 경유지는 5곳까지(다 차면 추가 버튼 숨김)', await D.locator('#tf-wps .tf-wp').count() === 5 && !(await D.locator('[data-action="tf-wp-add"]').isVisible()));
  await D.click('#tf-wps .tf-wp-row:nth-child(5) [data-action="tf-wp-del"]');
  check('1 하나 빼면 추가 버튼 다시', await D.locator('[data-action="tf-wp-add"]').isVisible());
  await D.click('[data-action="trip-start-pick"][data-val="empty"]');
  await D.click('[data-action="trip-save"]'); await settle();
  let T = tripBy(A, '홍천 가을 캠핑');
  check('1 저장: address + waypoints(빈 칸은 빼고 순서대로)', T && T.address === '강원 홍천군 서면 마곡길 123' && JSON.stringify(T.waypoints) === JSON.stringify(['하나로마트 홍천점', '홍천 정육점']), T);

  // ================= 2. 일정 패널: 주소 줄 =================
  check('2 일정 패널에 주소 줄(경유 n곳 · 주소) + "주소 보기"', /경유 2곳 · 강원 홍천군 서면 마곡길 123/.test(await D.locator('.trip-panel .tp-route').innerText()) && /주소 보기/.test(await D.locator('.tp-route [data-action="trip-route"]').innerText()));
  await D.click('.tp-route [data-action="trip-route"]'); await settle();
  const tags = await D.locator('#modal-root .route-tag').allInnerTexts();
  const texts = await D.locator('#modal-root .route-main > span:first-child').allInnerTexts();
  check('2 경유지가 있으면 "길 안내 주소" 창: 경유 1 → 경유 2 → 도착 순서', JSON.stringify(tags) === JSON.stringify(['경유 1', '경유 2', '도착']) && JSON.stringify(texts) === JSON.stringify(['하나로마트 홍천점', '홍천 정육점', '강원 홍천군 서면 마곡길 123'])
    && /홍천 강변 캠핑장/.test(await D.locator('#modal-root .route-item:last-child').innerText()), [tags, texts]);
  await D.click('#modal-root .route-item:nth-child(1) [data-action="route-copy"]'); await settle();
  await D.click('#modal-root .route-item:nth-child(3) [data-action="route-copy"]'); await settle();
  check('2 각 줄 "복사" → 그 주소만 복사 + 안내', JSON.stringify(await copied(D)) === JSON.stringify(['하나로마트 홍천점', '강원 홍천군 서면 마곡길 123']) && /복사했어요/.test(await D.locator('#toast').innerText()));
  await D.click('#modal-root [data-action="route-copy"][data-all="1"]'); await settle();
  check('2 "전체 복사" → 순서대로 여러 줄', (await copied(D)).pop() === '경유 1: 하나로마트 홍천점\n경유 2: 홍천 정육점\n도착: 강원 홍천군 서면 마곡길 123');
  const btnH = await D.locator('#modal-root .route-item [data-action="route-copy"]').first().boundingBox();
  check('2 복사 버튼 누르는 영역 높이 ≥ 40px', btnH.height >= 40, btnH);
  await D.click('#modal-root [data-action="modal-close"]'); await settle();

  // ================= 3. 수정: 경유지 지우면 바로 복사, 모두 비우면 필드 삭제 =================
  await menuClick(D, '.trip-panel [data-action="trip-edit"]'); await settle();
  check('3 수정 창에 주소·경유지가 채워짐', (await D.inputValue('#tf-address')) === '강원 홍천군 서면 마곡길 123' && JSON.stringify(await D.locator('#tf-wps .tf-wp').evaluateAll(els => els.map(e => e.value))) === JSON.stringify(['하나로마트 홍천점', '홍천 정육점']));
  await D.click('#tf-wps .tf-wp-row:nth-child(1) [data-action="tf-wp-del"]');
  await D.fill('#tf-wps .tf-wp', '  ');
  await D.click('[data-action="trip-save"]'); await settle();
  T = tripBy(A, '홍천 가을 캠핑');
  check('3 경유지를 모두 비우면 waypoints 삭제, 다른 필드 유지', !('waypoints' in T) && T.address === '강원 홍천군 서면 마곡길 123' && T.campsiteName === '홍천 강변 캠핑장', T);
  check('3 경유지가 없으면 버튼이 "복사"', /복사/.test(await D.locator('.tp-route [data-action="trip-route"]').innerText()) && !/경유/.test(await D.locator('.tp-route').innerText()));
  await D.click('.tp-route [data-action="trip-route"]'); await settle();
  check('3 "복사" → 창 없이 바로 주소 복사', (await copied(D)).pop() === '강원 홍천군 서면 마곡길 123' && await D.locator('#modal-root .route-list').count() === 0);

  // ================= 4. Home 다음 캠핑 =================
  await nav(D, 'home'); await settle();
  check('4 Home 다음 캠핑 카드 아래 "캠핑장 주소 복사 · 주소"', /캠핑장 주소 복사 · 강원 홍천군 서면 마곡길 123/.test(await D.locator('.next-trip-route').innerText()));
  await D.click('.next-trip-route'); await settle();
  check('4 Home에서 바로 복사(Checklist로 이동하지 않음)', (await copied(D)).pop() === '강원 홍천군 서면 마곡길 123' && (await D.evaluate(() => state.currentView)) === 'home');

  // ================= 5. 주소 없는 일정은 그대로 / 지우면 줄 없음 =================
  await nav(D, 'checklist'); await settle();
  await D.locator('.trip-chip:has-text("예전 일정")').first().click(); await settle();
  check('5 주소·경유지 없는 예전 일정: 주소 줄 없음', await D.locator('.trip-panel .tp-route').count() === 0 && await D.locator('.trip-panel').count() === 1);
  await D.locator('.trip-chip:has-text("홍천 가을 캠핑")').first().click(); await settle();
  await menuClick(D, '.trip-panel [data-action="trip-edit"]'); await settle();
  await D.fill('#tf-address', '');
  await D.click('[data-action="trip-save"]'); await settle();
  T = tripBy(A, '홍천 가을 캠핑');
  check('5 주소를 비우면 address 삭제 + 줄 사라짐', !('address' in T) && await D.locator('.trip-panel .tp-route').count() === 0);

  // ================= 6. 그룹 일정: 경유지만 있어도 창, 멤버에게 보임 =================
  await D.locator('.space-chip:has-text("캠핑팸")').first().click(); await settle();
  if (await D.locator('[data-action="space-note-ok"]').count()) await D.click('[data-action="space-note-ok"]');
  await D.click('[data-action="trip-new"]'); await settle();
  await D.fill('#tf-title', '팸 캠핑'); await D.fill('#tf-start', ymd(2));
  await D.click('[data-action="tf-wp-add"]'); await D.keyboard.type('서울역 3번 출구');
  await D.click('[data-action="trip-start-pick"][data-val="empty"]');
  await D.click('[data-action="trip-save"]'); await settle();
  const GT = tripBy(G, '팸 캠핑');
  check('6 그룹 일정에도 경유지 저장', GT && JSON.stringify(GT.waypoints) === JSON.stringify(['서울역 3번 출구']) && !('address' in GT), GT);
  const B = await phone(UB, { mobile: true });
  await nav(B, 'checklist'); await settle();
  await B.locator('.space-chip:has-text("캠핑팸")').first().click(); await settle();
  if (await B.locator('[data-action="space-note-ok"]').count()) await B.click('[data-action="space-note-ok"]');
  await B.locator('.trip-chip:has-text("팸 캠핑")').first().click(); await settle();
  check('6 멤버(밥, 390px)에게도 주소 줄', /경유 1곳/.test(await B.locator('.trip-panel .tp-route').innerText()));
  await B.click('.tp-route [data-action="trip-route"]'); await settle();
  check('6 경유지만 있으면 창 + 캠핑장 주소 없다는 안내, 전체 복사 없음', JSON.stringify(await B.locator('#modal-root .route-tag').allInnerTexts()) === JSON.stringify(['경유 1']) && /캠핑장 주소는 아직 없어요/.test(await B.locator('#modal-root').innerText())
    && await B.locator('#modal-root [data-all="1"]').count() === 0);
  const rowBox = await B.locator('#modal-root .route-item').first().boundingBox();
  check('6 390px 시트: 주소 줄이 화면 안에(가로 넘침 없음)', rowBox && rowBox.x >= 0 && rowBox.x + rowBox.width <= 390, rowBox);
  await B.click('#modal-root [data-action="route-copy"]'); await settle();
  check('6 멤버도 복사', (await copied(B)).pop() === '서울역 3번 출구');

  // ================= 7. 개인 백업에 그대로 =================
  const bk = await D.evaluate(() => buildBackup());
  check('7 개인 백업의 일정에 주소·경유지 필드가 그대로(일정 객체 통째)', Array.isArray(bk.trips) && bk.trips.some(t => t.title === '홍천 가을 캠핑'));

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
