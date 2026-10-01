// I. Gear 수정 테스트 (가짜 Firestore/Auth):
//  1 장비 줄 삭제는 X 버튼(⋯ 없음, 390px 맨 아래 장비도 눌림, 되돌리기), 2 선택 모드에서 카테고리별 전체 선택(묶음·소분류·고른 카테고리, 일부면 mixed),
//  3 카테고리 관리 버튼이 "장비 추가"와 같은 줄에 바로 보임
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

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
