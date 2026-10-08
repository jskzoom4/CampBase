// 전체 기능 클릭 스모크 테스트 (공유 앱 + 가짜 Firestore). 실행: node tests/smoke.test.js
// Broad smoke test: click through every tab and common interactions,
// watching for the diagnostic toast/console signature that the new
// global try/catch safety net emits, plus raw pageerrors, to find
// ANY exception the user might be hitting -- since their report gave
// no specific action ("작업 중 오류가 발생했어요" with no other context).
const { chromium } = require('playwright');
const { menuClick } = require('./ui-helpers');
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.join(__dirname, '..');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-smoke-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'const firebaseConfig = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", storageBucket: "x", messagingSenderId: "1", appId: "1:1:web:1" };\nwindow.FIREBASE_CONFIG = firebaseConfig;\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

(async () => {
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const server = {};
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.exposeFunction('__fsDump', () => JSON.parse(JSON.stringify(server)));
  await ctx.exposeFunction('__fsWrite', async (p, d) => { if (d === null) delete server[p]; else server[p] = d; });
  // 외부 폰트는 테스트와 무관 → 빈 응답 (프록시 인증서 오류로 콘솔 에러가 나지 않게)
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
  // 가짜 구글 로그인 사용자 (팝업에서 이 사람이 선택됨)
  await ctx.addInitScript(() => { window.__fakePopupUser = { uid: 'smokeUser', displayName: '스모크', email: 'smoke@example.com', photoURL: '' }; });
  await ctx.addInitScript(fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8'));
  const page = await ctx.newPage();
  // camp-del/gear-del/cl-del-list/resetChecklist now open an in-app
  // confirmModal() (native window.confirm() is silently blocked inside the
  // real Artifact's sandboxed iframe -- see the "대분류 삭제 아이콘 무반응"
  // fix). Fail loudly if a native dialog ever appears again, since that
  // would mean the app regressed back to window.confirm().
  page.on('dialog', d => { issues.push('UNEXPECTED NATIVE DIALOG: ' + d.message()); d.dismiss(); });
  async function clickAndConfirm(locator, label) {
    await menuClick(page, locator);   // ⋯ 메뉴 안으로 옮긴 버튼이면 메뉴를 열고 누름
    await page.waitForTimeout(120);
    const confirmBtn = page.locator('[data-action="confirm-yes"]');
    if (await confirmBtn.count()) { await confirmBtn.click(); await page.waitForTimeout(150); return true; }
    issues.push('confirmModal did not appear after clicking ' + (label || 'target'));
    return false;
  }
  const issues = [];

  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('wireGlobalActions') || (msg.type() === 'error' && !t.includes('ERR_TUNNEL_CONNECTION_FAILED'))) {
      issues.push('CONSOLE[' + msg.type() + ']: ' + t);
    }
  });
  page.on('pageerror', err => issues.push('PAGEERROR: ' + err.message));

  const srv = require('child_process').spawn('python3', ['-m','http.server','8767','-d',SITE], {stdio:'ignore'});
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });   // 실패로 끝나도 서버를 남기지 않음(남으면 다음 실행이 예전 코드를 받음)
  await new Promise(r=>setTimeout(r,700));
  await page.goto('http://127.0.0.1:8767/');
  // 0. 로그인 화면 → Google로 시작하기
  await page.waitForSelector('#login-btn:not([disabled])', { timeout: 5000 });
  await page.click('[data-action="login-google"]');
  await page.waitForFunction(() => /자동 저장|로컬 미리보기/.test(document.getElementById('db-status').textContent || ''), { timeout: 5000 });

  const log = (label) => console.log('--- after: ' + label + ' | issues so far: ' + issues.length);

  // 1. Click through every top nav tab
  for (const tab of ['home', 'camping', 'gear', 'checklist', 'cooking', 'settings']) {
    await page.click(`[data-nav="${tab}"]`);
    await page.waitForTimeout(150);
    log('nav -> ' + tab);
  }

  // 2. Home: click each stat card title/legend (home-cat-nav) to jump to tabs
  await page.click('[data-nav="home"]');
  await page.waitForTimeout(150);
  const homeCatLinks = await page.locator('[data-action="home-cat-nav"]:visible').count();   // 화면 폭에 따라 원형/막대 중 보이는 것만
  console.log('home-cat-nav elements found:', homeCatLinks);
  for (let i = 0; i < homeCatLinks; i++) {
    try {
      await page.locator('[data-action="home-cat-nav"]:visible').nth(i).click();
      await page.waitForTimeout(120);
      log('home-cat-nav #' + i);
      await page.click('[data-nav="home"]');
      await page.waitForTimeout(120);
    } catch (e) { issues.push('CLICK-FAIL home-cat-nav#' + i + ': ' + e.message); }
  }

  // 3. Settings: toggle every widget switch twice (off/on)
  await page.click('[data-nav="settings"]');
  await page.waitForTimeout(150);
  // The real checkbox input is visually hidden (opacity:0, 0x0) by design --
  // a real user clicks the visible ".switch" label, which is what actually
  // dispatches the native click/change. Click that instead of the input.
  const switches = await page.locator('label.switch').count();
  console.log('widget switches found:', switches);
  for (let i = 0; i < switches; i++) {
    try {
      await page.locator('label.switch').nth(i).click({ timeout: 3000 });
      await page.waitForTimeout(100);
      await page.locator('label.switch').nth(i).click({ timeout: 3000 });
      await page.waitForTimeout(100);
    } catch (e) { issues.push('CLICK-FAIL toggle-widget#' + i + ': ' + e.message); }
  }
  log('settings toggles');

  // 4. Camping: open new record modal, fill, save; then filter chips
  await page.click('[data-nav="camping"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="camp-new"]');
  await page.waitForTimeout(150);
  await page.fill('#cf-name', '스모크테스트캠핑장');
  await page.fill('#cf-region', '테스트지역');
  await page.click('[data-action="camp-save"]');
  await page.waitForTimeout(200);
  log('camping add');
  const campFilters = await page.locator('[data-action="camp-filter"]').count();
  for (let i = 0; i < campFilters; i++) {
    await page.locator('[data-action="camp-filter"]').nth(i).click();
    await page.waitForTimeout(80);
  }
  await page.locator('[data-action="camp-filter"]').first().click(); // back to 'all'
  await page.waitForTimeout(100);
  log('camping filters');
  // edit + delete the one we just made (delete now goes through confirm(), auto-accepted above)
  const editBtn = page.locator('[data-action="camp-edit"]').first();
  if (await editBtn.count()) { await editBtn.click(); await page.waitForTimeout(120); await page.click('[data-action="modal-close"]'); await page.waitForTimeout(80); }
  log('camping edit-open/close');
  const campDelBtn = page.locator('[data-action="camp-del"]').first();
  const campDelFound = await campDelBtn.count();
  if (campDelFound) { await clickAndConfirm(campDelBtn, 'camp-del'); }
  log('camping delete (confirmed), found=' + campDelFound);

  // 5. Gear: open new gear modal, save; category management; filters
  await page.click('[data-nav="gear"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="gear-new"]');
  await page.waitForTimeout(150);
  await page.fill('#gf-name', '스모크테스트장비');
  await page.click('[data-action="gear-save"]');
  await page.waitForTimeout(200);
  log('gear add');
  const gearFilters = await page.locator('[data-action="gear-filter"]').count();
  for (let i = 0; i < gearFilters; i++) {
    await page.locator('[data-action="gear-filter"]').nth(i).click();
    await page.waitForTimeout(80);
  }
  log('gear filters');
  await page.locator('[data-action="gear-filter"]').first().click(); // back to 'all'
  await page.waitForTimeout(100);
  await menuClick(page, '[data-action="gear-cat-manage"]');
  await page.waitForTimeout(150);
  const catInput = page.locator('#cat-new-name');
  if (await catInput.count()) {
    await catInput.fill('테스트카테고리');
    await page.click('[data-action="gear-cat-add"]');
    await page.waitForTimeout(150);
    log('gear category add');
  }
  await page.click('[data-action="modal-close"]');
  await page.waitForTimeout(100);
  const gearDelBtn = page.locator('[data-action="gear-del"]').first();
  const gearDelFound = await gearDelBtn.count();
  if (gearDelFound) { await clickAndConfirm(gearDelBtn, 'gear-del'); }
  log('gear delete (confirmed), found=' + gearDelFound);

  // 6. Checklist: new list, add item, group add, group rename, toggle, delete item
  await page.click('[data-nav="checklist"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="cl-new-list"]');
  await page.waitForTimeout(150);
  await page.fill('#ncl-title', '스모크테스트리스트');
  await page.click('[data-action="cl-new-list-save"]');
  await page.waitForTimeout(200);
  log('checklist new list');

  const addItemBtns = page.locator('[data-action="cl-add-item"]');
  const addCount = await addItemBtns.count();
  console.log('cl-add-item buttons:', addCount);
  await addItemBtns.last().click();
  await page.waitForTimeout(150);
  await page.fill('#cli-label', '스모크항목');
  await page.fill('#cli-group', '스모크소분류');
  await page.click('[data-action="cl-add-item-save"]');
  await page.waitForTimeout(200);
  log('checklist add item');

  // toggle the packed status on the item we just made
  const cb = page.locator('[data-action="cl-item-status"][data-val="packed"]').last();
  if (await cb.count()) { await cb.click(); await page.waitForTimeout(150); log('checklist status toggle'); }
  // exercise the list reset button too
  const resetBtn = page.locator('[data-action="cl-list-reset"]').last();
  if (await resetBtn.count()) { await clickAndConfirm(resetBtn, 'cl-list-reset'); log('checklist reset'); }

  // group rename
  const renameBtn = page.locator('[data-action="cl-group-rename"]').last();
  if (await renameBtn.count()) {
    await menuClick(page, renameBtn);
    await page.waitForTimeout(150);
    const nameInput = page.locator('#clg-name');
    if (await nameInput.count()) {
      await nameInput.fill('스모크소분류변경');
      await page.click('[data-action="cl-group-rename-save"]');
      await page.waitForTimeout(150);
      log('checklist group rename');
    }
  }

  // checklist filters
  const clFilters = await page.locator('[data-action="cl-filter"]').count();
  for (let i = 0; i < clFilters; i++) {
    await page.locator('[data-action="cl-filter"]').nth(i).click();
    await page.waitForTimeout(80);
  }
  log('checklist filters');
  await page.locator('[data-action="cl-filter"]').first().click();
  await page.waitForTimeout(100);

  // delete the item, then the list
  const delItem = page.locator('[data-action="cl-del-item"]').last();
  if (await delItem.count()) { await menuClick(page, delItem); await page.waitForTimeout(150); log('checklist del item'); }
  const delList = page.locator('[data-action="cl-del-list"]').last();
  if (await delList.count()) { await clickAndConfirm(delList, 'cl-del-list'); log('checklist del list'); }

  // 7. Cooking: 식단표(레시피 탭 없음) — 일정이 있으면 메뉴 직접 입력(이름 + 재료) → 장보기
  await page.click('[data-nav="cooking"]');
  await page.waitForTimeout(150);
  if (await page.locator('.cook-switch, [data-action="cook-view"], .recipe-card').count()) issues.push('cooking: 레시피 탭이 아직 있음');
  const addDish = page.locator('[data-action="meal-add-dish"]').first();
  if (await addDish.count()) {
    await addDish.click(); await page.waitForTimeout(150);
    await page.fill('#mp-custom', '부대찌개');
    await page.fill('#mp-ings', '햄 200g, 라면사리 1개');
    await page.click('[data-action="mp-go"]'); await page.waitForTimeout(200);
    log('cooking add dish');
    const mk = page.locator('[data-action="shop-create"]:not([disabled])');
    if (await mk.count()) { await mk.click(); await page.waitForTimeout(200); log('cooking shopping list'); }
  }

  // 8. Settings: 기존 공유 데이터 가져오기(빈 상태) + 백업 내보내기 + 로그아웃
  await page.click('[data-nav="settings"]');
  await page.waitForTimeout(150);
  // 예전 공유 데이터가 없으면 가져오기 버튼은 숨겨짐
  await page.waitForTimeout(300);
  if (await page.locator('[data-action="legacy-import"]').count()) issues.push('legacy-import button shown although there is no legacy data');
  log('legacy import hidden (no legacy data)');
  await page.click('[data-action="backup-export"]');
  await page.waitForTimeout(120);
  await page.click('[data-action="modal-close"]');
  log('backup export');
  if (!(await clickAndConfirm(page.locator('[data-action="logout"]'), 'logout'))) issues.push('logout confirm missing');
  await page.waitForTimeout(200);
  if (!(await page.locator('#login-screen').isVisible())) issues.push('login screen not shown after logout');
  log('logout');
  const foreign = await page.evaluate(() => window.__fsAccess.filter(x => x !== 'users/smokeUser' && !x.startsWith('users/smokeUser/') && !/^(campingLogs|gear|checklists|cookingChecks|app\/settings|groups)$/.test(x)));
  if (foreign.length) issues.push('accessed paths outside own space: ' + foreign.join(', '));
  if (Object.keys(server).some(k => !k.startsWith('users/smokeUser'))) issues.push('wrote outside own space: ' + Object.keys(server).join(', '));

  console.log('\n=== TOTAL ISSUES CAPTURED:', issues.length, '===');
  issues.forEach(i => console.log(' -', i));
  if (issues.length === 0) console.log('RESULT: PASS — no errors/diagnostic toasts triggered across full smoke pass.');
  else { console.log('RESULT: FAIL — see issues above.'); process.exitCode = 1; }

  await browser.close(); srv.kill();
  console.log('server docs after smoke:', Object.keys(server).length);
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
