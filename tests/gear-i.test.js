// I. Gear 수정 테스트 (가짜 Firestore/Auth):
//  1 장비 줄 삭제는 X 버튼(⋯ 없음, 390px 맨 아래 장비도 눌림, 되돌리기), 2 선택 모드에서 카테고리별 전체 선택(묶음·소분류·고른 카테고리, 일부면 mixed),
//  3 카테고리 관리 버튼이 "장비 추가"와 같은 줄에 바로 보임, 4 장비 개수·소비전력(W) 입력(저장·수정·비우기·잘못된 값·목록 표시·체크리스트 개수),
//  5 지난 일정 카드·일정 패널의 "내 후기 작성함" 아이콘 크기(12px)
// 실행: node tests/gear-i.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick, gearAction } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-geari-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8778;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const server = {};
(function seed() {
  const A = 'users/uidAlice/';
  server[A + 'settings/app'] = { gearCategories: ['텐트', '타프', '침낭', '조리용품'], homeWidgets: { nextTrip: true, camping: true, gear: true, checklist: true },
    gearCategoryMeta: { majors: [{ name: '쉘터', desc: '' }], subs: [{ name: '텐트', major: '쉘터', desc: '' }, { name: '타프', major: '쉘터', desc: '' }] } };
  const gear = [['g1', '스텔스 텐트', '텐트'], ['g2', '돔 텐트', '텐트'], ['g3', '렉타 타프', '타프'], ['g4', '오로라 침낭', '침낭'], ['g5', '여름 침낭', '침낭'],
    ['g6', '버너', '조리용품'], ['g7', '코펠', '조리용품'], ['g8', '아이스박스', '조리용품'], ['g9', '랜턴', '조리용품']];
  server[A + 'checklists/cl1'] = { title: '준비물', items: [] };
  server[A + 'trips/tp1'] = { title: '지난 캠핑', startDate: ymd(-10), endDate: ymd(-9), campsiteName: '숲속캠핑장', region: '강원' };
  server[A + 'campingLogs/log1'] = { name: '숲속캠핑장', date: ymd(-10), region: '강원', rating: 4, tripRef: { space: 'me', tripId: 'tp1' } };
  gear.forEach(([id, name, category]) => { server[A + 'gear/' + id] = { name, brand: 'B', category, comment: '메모가 조금 긴 장비 ' + name }; });
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

  const M = await phone(UA, { mobile: true });
  const D = await phone(UA);

  // ================= 3. 카테고리 관리 버튼 =================
  await nav(M, 'gear'); await settle();
  const head = await M.evaluate(() => {
    const box = document.querySelector('.gear-head-actions');
    const add = box.querySelector('[data-action="gear-new"]'), cat = box.querySelector(':scope > [data-action="gear-cat-manage"]');
    const r = el => el && el.getBoundingClientRect();
    return { same: !!cat && cat.parentElement === add.parentElement, noMenu: !box.querySelector('.more'), catW: cat ? r(cat).width : 0, overflow: document.documentElement.scrollWidth > innerWidth + 1, right: cat ? r(cat).right : 0 };
  });
  check('3 카테고리 관리 = "장비 추가"와 같은 줄의 버튼(⋯ 메뉴 없음), 390px에서 넘침 없음', head.same && head.noMenu && head.catW > 40 && !head.overflow && head.right <= 390, head);
  await M.click('.gear-head-actions [data-action="gear-cat-manage"]');
  check('3 한 번 누르면 바로 카테고리 관리 창', await M.locator('#cat-manage-list').count() === 1);
  await M.click('[data-action="modal-close"]'); await settle();

  // ================= 1. X 버튼으로 삭제 =================
  check('1 장비 줄에 ⋯ 메뉴 없음, X(삭제) 버튼은 aria-label·40×40', (await M.locator('.gear-row .more-btn').count()) === 0
    && await M.locator('.gear-row [data-action="gear-del"]').first().evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 40 && r.height >= 40 && /삭제/.test(el.getAttribute('aria-label')); }));
  // 맨 아래 묶음의 마지막 장비(조리용품 랜턴): 탭바 위로 스크롤해서도 X가 실제로 눌리는지
  const lastDel = M.locator('.gear-sec').last().locator('.gear-row').last().locator('[data-action="gear-del"]');
  await lastDel.scrollIntoViewIfNeeded();
  const hit = await lastDel.evaluate(el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (h === el || el.contains(h)); });
  check('1 카테고리 맨 아래 장비의 X 버튼도 가리지 않고 눌림', hit);
  const lastId = await M.locator('.gear-sec').last().locator('.gear-row').last().getAttribute('data-id');
  await lastDel.click();
  await M.waitForSelector('[data-action="confirm-yes"]');
  await M.click('[data-action="confirm-yes"]'); await settle();
  check('1 X → 확인 → 삭제', !server['users/uidAlice/gear/' + lastId], lastId);
  await M.click('[data-action="undo-delete"]'); await settle();
  check('1 되돌리기로 복구', !!server['users/uidAlice/gear/' + lastId]);

  // ================= 2. 카테고리별 전체 선택 =================
  await nav(D, 'gear'); await settle();
  await D.click('[data-action="gear-select"]');
  const secBox = name => D.locator(`.gear-sec:has(.gear-sec-name:text-is("${name}")) .gear-sec-top [data-action="gear-pick-many"]`);
  check('2 선택 모드: 카테고리 묶음마다 전체 선택 상자(aria-label)', (await D.locator('.gear-sec-top [data-action="gear-pick-many"]').count()) === (await D.locator('.gear-sec').count())
    && /전체 선택/.test(await secBox('조리용품').getAttribute('aria-label')));
  await secBox('조리용품').click();
  const picked = () => D.locator('.gear-row.picked').evaluateAll(els => els.map(e => e.dataset.id).sort().join(','));
  check('2 묶음 전체 선택 → 그 묶음 장비만 모두(4개) + 액션 바 "4개 선택"', (await picked()) === 'g6,g7,g8,g9' && /4개 선택/.test(await D.locator('.select-bar').innerText())
    && (await secBox('조리용품').getAttribute('aria-checked')) === 'true');
  await D.click('.gear-row[data-id="g7"]');
  check('2 하나 빼면 묶음 상자는 일부(mixed)', (await secBox('조리용품').getAttribute('aria-checked')) === 'mixed');
  await secBox('조리용품').click();
  check('2 일부일 때 누르면 다시 모두', (await picked()) === 'g6,g7,g8,g9');
  await secBox('조리용품').click();
  check('2 모두일 때 누르면 모두 해제', (await picked()) === '');
  const subBox = D.locator('.gear-sub-head:has(.gear-sub-name:text-is("텐트")) [data-action="gear-pick-many"]');
  await subBox.click();
  check('2 대분류 안 소분류(텐트)만 전체 선택', (await picked()) === 'g1,g2' && (await secBox('쉘터').getAttribute('aria-checked')) === 'mixed');
  await secBox('쉘터').click();
  check('2 대분류(쉘터) 전체 선택 = 텐트+타프', (await picked()) === 'g1,g2,g3');
  await D.click('.gear-cat-row [data-action="gear-filter"][data-cat="침낭"]'); await settle();
  check('2 카테고리 칩을 고른 목록에도 "전체 선택" 줄', await D.locator('.gear-pick-all-row').isVisible());
  await D.click('.gear-pick-all-row [data-action="gear-pick-many"]');
  check('2 그 목록 전체 선택(기존 선택은 유지)', /5개 선택/.test(await D.locator('.select-bar').innerText()));
  await D.click('.select-bar [data-action="gear-to-checklist"]').catch(() => {});
  check('2 고른 장비로 다음 동작(체크리스트에 추가 창에 미리 체크 5개)', (await D.locator('.g2c-gear:checked').count()) === 5);
  await D.click('[data-action="modal-close"]'); await settle();
  await D.click('[data-action="gear-select-cancel"]').catch(() => {});
  check('2 선택 모드가 아닐 땐 전체 선택 상자 없음', (await D.locator('[data-action="gear-pick-many"]').count()) === 0);

  // ================= 4. 개수·소비전력(W) =================
  await nav(D, 'gear'); await settle();
  await D.click('.gear-cat-row [data-action="gear-filter"][data-cat="all"]'); await settle();
  await D.click('[data-action="gear-edit"][data-id="g9"]'); await settle();
  check('4 장비 수정 창에 개수(−/+)·소비전력 W 칸', (await D.locator('#cli-qty').count()) === 1 && (await D.locator('#gf-watt').count()) === 1
    && (await D.locator('[data-action="cli-qty-step"]').count()) === 2);
  await D.fill('#cli-qty', '0'); await D.click('[data-action="gear-save"]'); await settle();
  check('4 잘못된 개수(0)는 저장 막음', (await D.locator('#gf-name').count()) === 1 && server['users/uidAlice/gear/g9'].qty === undefined);
  await D.fill('#cli-qty', '1'); await D.click('[data-action="cli-qty-step"][data-d="1"]');
  await D.fill('#gf-watt', '-5'); await D.click('[data-action="gear-save"]'); await settle();
  check('4 잘못된 소비전력(-5)은 저장 막음', (await D.locator('#gf-name').count()) === 1 && server['users/uidAlice/gear/g9'].watt === undefined);
  await D.fill('#gf-watt', '12.5'); await D.click('[data-action="gear-save"]'); await settle();
  const g9 = server['users/uidAlice/gear/g9'];
  check('4 저장: qty 2, watt 12.5, 기존 필드(메모·브랜드) 유지', g9.qty === 2 && g9.watt === 12.5 && g9.brand === 'B' && /메모/.test(g9.comment), g9);
  const row9 = await D.locator('.gear-row[data-id="g9"] .meta').innerText();
  check('4 목록 줄에 "×2"·"12.5W"', /×2/.test(row9) && /12\.5W/.test(row9), row9);
  check('4 개수·W가 없는 장비는 표시 없음', !/×|W/.test(await D.locator('.gear-row[data-id="g8"] .meta').innerText()));
  await D.click('[data-action="gear-new"]'); await settle();
  await D.fill('#gf-name', '전기장판'); await D.fill('#gf-watt', '150'); await D.click('[data-action="gear-save"]'); await settle();
  const ep = Object.entries(server).find(([k, v]) => k.startsWith('users/uidAlice/gear/') && v.name === '전기장판');
  check('4 새 장비: W만 넣으면 watt만(qty 없음)', ep && ep[1].watt === 150 && ep[1].qty === undefined, ep && ep[1]);
  // 체크리스트에 추가하면 개수가 준비물 개수로
  await D.click('[data-action="gear-select"]'); await settle();
  await D.click('.gear-row[data-id="g9"]'); await D.click('.gear-row[data-id="g8"]');
  await D.click('.select-bar [data-action="gear-to-checklist"]'); await settle();
  await D.click('[data-action="g2c-go"]').catch(() => {}); await settle();
  const items = (server['users/uidAlice/checklists/cl1'].items || []);
  const lan = items.find(i => i.label === '랜턴'), ice = items.find(i => i.label === '아이스박스');
  check('4 체크리스트에 추가: 랜턴 qty 2, 아이스박스는 개수 없음', lan && lan.qty === 2 && ice && ice.qty === undefined, items);
  // 비우면 필드 삭제
  await nav(D, 'gear'); await settle();
  await D.click('[data-action="gear-edit"][data-id="g9"]'); await settle();
  await D.fill('#cli-qty', ''); await D.fill('#gf-watt', ''); await D.click('[data-action="gear-save"]'); await settle();
  check('4 비우고 저장하면 qty·watt 삭제', !('qty' in server['users/uidAlice/gear/g9']) && !('watt' in server['users/uidAlice/gear/g9']));

  // ================= 5. 내 후기 작성함 아이콘 크기 =================
  const iconSize = async (p, sel) => p.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  await D.evaluate(() => goView('pastTrips')); await settle();
  const s1 = await iconSize(D, '.past-trip-card .done-tag svg');
  check('5 지난 일정 카드 "내 후기 작성함" 아이콘 12×12', s1[0] === 12 && s1[1] === 12, s1);
  await D.click('[data-action="past-trip-open"][data-trip="tp1"]'); await settle();
  const s2 = await iconSize(D, '.trip-reviewed svg');
  check('5 일정 패널 "내 후기 작성함" 아이콘 12×12', s2[0] === 12 && s2[1] === 12, s2);

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
