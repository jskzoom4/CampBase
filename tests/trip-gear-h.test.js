// H. 일정 → 장비에서 불러오기 + 일정 메모 테스트 (가짜 Firestore/Auth):
//  일정 만들기 "장비에서 고르기" → 바로 장비 고르기 창, 전체 선택·묶음 선택·이미 있는 항목 제외, 리스트 ⋯ 메뉴·빈 리스트·빈 일정에서 불러오기,
//  그룹 공간: 그룹 장비(주인 → 담당자) / 내 장비(나 → 담당자), 일정 메모(Description) 저장·표시·지우기
// 실행: node tests/trip-gear-h.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick, gearAction } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-triph-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8777;

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
  server[A + 'settings/app'] = { gearCategories: ['텐트', '타프', '침낭'], homeWidgets: { nextTrip: true, camping: true, gear: true, checklist: true },
    gearCategoryMeta: { majors: [{ name: '쉘터', desc: '' }], subs: [{ name: '텐트', major: '쉘터', desc: '' }, { name: '타프', major: '쉘터', desc: '' }] } };
  server[A + 'gear/g1'] = { name: '스텔스 텐트', brand: 'Snow Peak', category: '텐트' };
  server[A + 'gear/g2'] = { name: '렉타 타프', brand: 'DOD', category: '타프' };
  server[A + 'gear/g3'] = { name: '오로라 침낭', brand: 'Nanga', category: '침낭' };
  server[A + 'gear/g4'] = { name: '랜턴', brand: '', category: '' };
  server[A + 'checklists/old'] = { title: '예전 리스트', items: [{ id: 'x1', label: '랜턴', status: 'pending', group: '조명' }] };
  server[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob'], createdAt: '1', gearCategories: ['텐트'],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member') } };
  server[G + '/gear/gg1'] = { name: '그룹 텐트', brand: 'Coleman', category: '텐트', ownerUid: 'uidBob', addedBy: 'uidBob' };
  server[G + '/gear/gg2'] = { name: '공용 버너', brand: 'Kovea', category: '', addedBy: 'uidBob' };
  server[G + '/trips/gt'] = { title: '팸 캠핑', startDate: '2099-10-03', endDate: '2099-10-04', campsiteName: '', region: '', memberUids: ['uidAlice', 'uidBob'], createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
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
  const pickSpace = async (p, label) => { await p.locator(`.space-chip:has-text("${label}")`).first().click(); await settle(); };
  const rect = (p, sel) => p.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });

  const D = await phone(UA);
  const listsOf = (base, tripId) => Object.entries(server).filter(([k, v]) => k.startsWith(base + 'checklists/') && v.tripId === tripId).map(([k, v]) => ({ id: k.split('/').pop(), ...v }));
  const labels = l => (l.items || []).map(i => i.label).sort();

  // ================= 일정 만들기 → 장비에서 고르기 =================
  await nav(D, 'checklist'); await settle();
  await D.click('[data-action="trip-new"]');
  check('일정 만들기: 템플릿이 없고 장비가 있으면 "장비에서 고르기"가 기본', await D.locator('#tf-start-method .seg-btn.active[data-val="gear"]').count() === 1);
  check('일정 만들기: 메모(Description) 칸', await D.locator('textarea#tf-desc').count() === 1);
  await D.fill('#tf-title', '가을 캠핑');
  await D.fill('#tf-start', '2099-09-20');
  await D.fill('#tf-desc', '사이트 A-12\n장작은 현장 구매');
  await D.click('[data-action="trip-save"]'); await settle();
  const trip = Object.entries(server).find(([k, v]) => k.startsWith('users/uidAlice/trips/') && v.title === '가을 캠핑');
  const tid = trip && trip[0].split('/').pop();
  check('일정 메모 저장', trip && trip[1].description === '사이트 A-12\n장작은 현장 구매', trip && trip[1]);
  check('만들자마자 장비 고르기 창이 열림(리스트 "가을 캠핑 준비물")', await D.locator('#modal-root .gpk-list').count() === 1 && /가을 캠핑 준비물/.test(await D.locator('#modal-root').innerText()));
  check('처음엔 아무것도 안 골라짐 → 불러오기 버튼 비활성', (await D.locator('#gpk-count').innerText()) === '0개 선택' && await D.locator('#gpk-go').isDisabled());
  const secs = await D.locator('.gpk-sec-row .sr-name').allInnerTexts();
  check('장비는 카테고리 묶음별(대분류 쉘터 → 침낭 → 미분류)', JSON.stringify(secs) === JSON.stringify(['쉘터', '침낭', '미분류']), secs);
  await D.click('.gpk-sec-row:has-text("쉘터") input');
  check('묶음 체크 → 그 묶음 장비만(2개) 선택', (await D.locator('.gpk-item:checked').count()) === 2 && (await D.locator('#gpk-count').innerText()) === '2개 선택'
    && await D.locator('#gpk-all').evaluate(el => el.indeterminate));
  await D.click('#gpk-all');
  check('전체 선택 → 4개 모두', (await D.locator('.gpk-item:checked').count()) === 4 && /4개 불러오기/.test(await D.locator('#gpk-go').innerText()));
  await D.click('.gpk-row:has-text("랜턴") input');
  check('하나 끄면 전체 선택은 일부 상태', await D.locator('#gpk-all').evaluate(el => !el.checked && el.indeterminate) && (await D.locator('#gpk-count').innerText()) === '3개 선택');
  await D.click('#gpk-all');
  await D.click('[data-action="gpk-go"]'); await settle();
  const tl = listsOf('users/uidAlice/', tid)[0];
  check('불러온 장비가 항목으로(카테고리 = 소분류, 모두 미정)', tl && JSON.stringify(labels(tl)) === JSON.stringify(['랜턴', '렉타 타프', '스텔스 텐트', '오로라 침낭'].sort())
    && tl.items.every(i => i.status === 'pending') && tl.items.find(i => i.label === '스텔스 텐트').group === '텐트' && tl.items.find(i => i.label === '랜턴').group === '기타', tl && tl.items);
  check('일정 패널에 메모 표시 + 불러온 항목 체크 가능', /사이트 A-12/.test(await D.locator('.trip-panel .tp-desc').innerText()) && (await D.locator('.trip-panel .check-row').count()) === 4);
  await D.locator('.trip-panel .check-row:has-text("오로라 침낭") [data-val="packed"]').click(); await settle();
  check('불러온 항목 체크(가져감) 저장', listsOf('users/uidAlice/', tid)[0].items.find(i => i.label === '오로라 침낭').status === 'packed');

  // ================= 다시 불러오기: 이미 있는 이름은 회색 =================
  await menuClick(D, `.trip-panel [data-action="cl-gear-import"]`);
  check('리스트 ⋯ 메뉴 "장비에서 불러오기"', await D.locator('#modal-root .gpk-list').count() === 1);
  check('이미 있는 장비는 "이미 있음" + 고를 수 없음, 전체 선택도 비활성', (await D.locator('.gpk-row.is-dup').count()) === 4 && (await D.locator('.gpk-item:not(:disabled)').count()) === 0 && await D.locator('#gpk-all').isDisabled());
  await D.click('[data-action="modal-close"]'); await settle();

  // 예전 리스트(랜턴 이미 있음): 전체 선택해도 랜턴은 빠짐
  await D.click('[data-action="trip-pick"][data-trip="all"]').catch(() => {}); await settle();
  await menuClick(D, `.checklist-group:has-text("예전 리스트") [data-action="cl-gear-import"]`);
  await D.click('#gpk-all');
  check('전체 선택은 이미 있는 항목(랜턴)을 빼고 3개', (await D.locator('.gpk-item:checked').count()) === 3);
  await D.click('[data-action="gpk-go"]'); await settle();
  check('예전 리스트에 3개 추가(중복 없음)', labels(server['users/uidAlice/checklists/old']).length === 4);

  // ================= 일정 수정: 메모 고치기·지우기 =================
  await D.click(`[data-action="trip-pick"][data-trip="${tid}"]`).catch(async () => { await D.locator('.trip-chip:has-text("가을 캠핑")').click(); }); await settle();
  await menuClick(D, '.trip-panel [data-action="trip-edit"]');
  check('일정 수정 창에 메모가 채워져 있음', (await D.inputValue('#tf-desc')) === '사이트 A-12\n장작은 현장 구매');
  await D.fill('#tf-desc', '');
  await D.click('[data-action="trip-save"]'); await settle();
  check('메모를 비우면 필드 삭제 + 패널에서 사라짐', !('description' in server['users/uidAlice/trips/' + tid]) && (await D.locator('.trip-panel .tp-desc').count()) === 0);

  // ================= 그룹: 빈 일정 → 장비에서 불러오기, 그룹/내 장비 =================
  await pickSpace(D, '캠핑팸');
  if (await D.locator('[data-action="space-note-ok"]').count()) await D.click('[data-action="space-note-ok"]');
  await D.locator('.trip-chip:has-text("팸 캠핑")').first().click(); await settle();
  check('리스트 없는 일정: "장비에서 불러오기" 버튼', await D.locator('.tp-empty [data-action="trip-gear-import"]').isVisible());
  await D.click('.tp-empty [data-action="trip-gear-import"]'); await settle();
  const gl = () => listsOf('groups/grpFam/', 'gt')[0];
  check('누르면 "팸 캠핑 준비물" 리스트를 만들고 고르기 창', gl() && gl().title === '팸 캠핑 준비물' && await D.locator('#modal-root .gpk-src').count() === 1);
  await D.click('#gpk-all');
  await D.click('[data-action="gpk-go"]'); await settle();
  const gItems = gl().items;
  check('그룹 장비: 주인(밥) → 담당자, 주인 없으면 담당자 없음, addedBy=나', gItems.find(i => i.label === '그룹 텐트').assigneeUid === 'uidBob' && !gItems.find(i => i.label === '공용 버너').assigneeUid && gItems.every(i => i.addedBy === 'uidAlice'), gItems);
  await menuClick(D, '.trip-panel [data-action="cl-gear-import"]');
  await D.click('[data-action="gpk-src"][data-src="me"]');
  check('그룹 공간에서 "내 장비"로 바꾸면 내 개인 장비 목록', (await D.locator('#modal-root .gpk-item').count()) === 4 && await D.locator('[data-action="gpk-src"][data-src="me"].active').count() === 1);
  await D.click('.gpk-row:has-text("오로라 침낭") input');
  await D.click('[data-action="gpk-go"]'); await settle();
  const mine = gl().items.find(i => i.label === '오로라 침낭');
  check('내 장비에서 불러온 항목은 내가 담당자', mine && mine.assigneeUid === 'uidAlice', mine);

  // 휴대폰: 고르기 창 체크박스 줄 높이·버튼 바
  const M = await phone(UA, { mobile: true });
  await nav(M, 'checklist'); await settle();
  await M.locator('.trip-chip:has-text("가을 캠핑")').first().click(); await settle();
  await menuClick(M, '.trip-panel [data-action="cl-gear-import"]');
  const rowH = await M.locator('.gpk-row').first().evaluate(el => el.getBoundingClientRect().height);
  check('390px: 고르기 창 줄 높이 ≥ 40px, 불러오기 버튼은 아래 고정 바에', rowH >= 40 && await M.locator('.modal-foot [data-action="gpk-go"]').count() === 1, rowH);

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
