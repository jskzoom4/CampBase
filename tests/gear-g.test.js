// G. Gear 보완 테스트 (가짜 Firestore/Auth):
//  1 제목 글꼴 통일, 2 카테고리 순서 바꾸기, 3 브랜드 직접 입력, 4 전체 = 카테고리별 묶음(접고 펴기, 기억),
//  5 가격·무게·구매일 없음 + 메모(Comment), 6 고른 카테고리가 장비 추가 기본값, 7 기본값 잠금 없음(기타도 삭제)·저장 안 한 사람은 쓰는 카테고리만,
//  8 대분류/소분류(그룹 공간 포함), 9 카테고리 설명
// 실행: node tests/gear-g.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick, gearAction } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-gearg-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8776;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const server = {};
(function seed() {
  const A = 'users/uidAlice/', B = 'users/uidBob/', G = 'groups/grpFam';
  const mem = (n, r) => ({ name: n, photoURL: '', role: r });
  server[A + 'settings/app'] = { gearCategories: ['텐트', '타프', '침낭', '기타'], homeWidgets: { nextTrip: true, camping: true, gear: true, checklist: true },
    gearCategoryMeta: { majors: [{ name: '잠자리', desc: '' }, { name: '쉘터', desc: '집 짓기' }],
      subs: [{ name: '텐트', major: '쉘터', desc: '4인용 이상' }, { name: '타프', major: '쉘터', desc: '' }, { name: '침낭', major: '잠자리', desc: '' }] } };
  server[A + 'gear/g1'] = { name: '스텔스 5 텐트', brand: 'Snow Peak', category: '텐트', comment: '폴대 하나 수리함' };
  server[A + 'gear/g2'] = { name: '렉타 타프', brand: 'DOD', category: '타프' };
  server[A + 'gear/g3'] = { name: '오로라 침낭', brand: 'Nanga', category: '침낭' };
  server[A + 'gear/g4'] = { name: '아이스박스', brand: '기타', category: '기타', price: 50000, weight: 3, date: '2024-01-01' };
  server[A + 'gear/g5'] = { name: '카테고리 없는 물건', brand: '', category: '' };
  server[A + 'gear/g6'] = { name: '해먹 하나', brand: 'ENO', category: '해먹' };   // 목록에 없는 카테고리
  server[B + 'gear/b1'] = { name: '밥의 버너', brand: 'Kovea', category: '조리용품' };
  server[B + 'gear/b2'] = { name: '밥의 텐트', brand: 'MSR', category: '텐트' };
  server[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob'], createdAt: '1', gearCategories: ['텐트', '기타'],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member') } };
  server[G + '/gear/gg1'] = { name: '그룹 텐트', brand: 'Coleman', category: '텐트', addedBy: 'uidBob' };
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
  const B = await phone(UB);
  const meta = () => server['users/uidAlice/settings/app'].gearCategoryMeta;
  const cats = () => server['users/uidAlice/settings/app'].gearCategories;
  const secNames = p => p.locator('.gear-sec .gear-sec-name').allInnerTexts();
  const openManage = async p => { await menuClick(p, '[data-action="gear-cat-manage"]'); await p.waitForSelector('#cat-manage-list'); };
  const editCat = async (p, name) => { await p.click(`#cat-manage-list [data-action="gear-cat-edit"][data-name="${name}"]`); await p.waitForSelector('#ce-name'); };

  // ================= 1. 글꼴 =================
  await nav(D, 'checklist'); await settle();
  const fonts = await D.evaluate(() => ({
    body: getComputedStyle(document.body).fontFamily,
    title: getComputedStyle(document.getElementById('view-title')).fontFamily,
    h3: (() => { const h = document.querySelector('.checklist-group h3'); return h ? getComputedStyle(h).fontFamily : getComputedStyle(document.body).fontFamily; })(),
    link: [...document.querySelectorAll('link[href*="fonts.googleapis"]')].map(l => l.href).join(' '),
    css: [...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => /Fraunces/.test(r.cssText)); } catch (e) { return false; } }),
  }));
  check('1 제목 글꼴이 본문과 같음(Fraunces 없음)', fonts.title === fonts.body && fonts.h3 === fonts.body && !/Fraunces/.test(fonts.link) && !fonts.css, fonts);

  // ================= 4. 전체 = 카테고리별 묶음 =================
  await nav(D, 'gear'); await settle();
  check('4 전체 보기: 대분류(쉘터는 순서상 뒤) → 대분류 없는 소분류(기타) → 목록에 없는 카테고리(해먹) → 미분류', JSON.stringify(await secNames(D)) === JSON.stringify(['잠자리', '쉘터', '기타', '해먹', '미분류']), await secNames(D));
  const shelter = D.locator('.gear-sec:has(.gear-sec-name:text-is("쉘터"))');
  check('4 대분류 묶음 안에 소분류 작은 제목(텐트·타프)과 그 장비', JSON.stringify(await shelter.locator('.gear-sub-name').allInnerTexts()) === JSON.stringify(['텐트', '타프'])
    && (await shelter.locator('.gear-row').count()) === 2, await shelter.locator('.gear-sub-name').allInnerTexts());
  check('9 소분류 설명이 묶음 안에 보임', /4인용 이상/.test(await shelter.locator('.gear-sub-desc').first().innerText()));
  check('9 대분류 설명이 묶음 머리에 보임', /집 짓기/.test(await shelter.locator('.gear-sec-desc').innerText()));
  await shelter.locator('[data-action="gear-sec-toggle"]').click();
  check('4 묶음 머리를 누르면 접힘(aria-expanded=false, 장비 안 보임)', (await shelter.locator('[data-action="gear-sec-toggle"]').getAttribute('aria-expanded')) === 'false' && !(await shelter.locator('.gear-row').first().isVisible()));
  await D.reload(); await D.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
  await nav(D, 'gear'); await settle();
  check('4 접은 상태는 새로고침해도 기억', (await shelter.locator('[data-action="gear-sec-toggle"]').getAttribute('aria-expanded')) === 'false' && (await D.locator('.gear-sec:has(.gear-sec-name:text-is("잠자리")) .gear-row').isVisible()));
  await shelter.locator('[data-action="gear-sec-toggle"]').click();
  check('4 다시 누르면 펼침', await shelter.locator('.gear-row').first().isVisible());

  // ================= 5. 메모 / 가격·무게·구매일 없음 =================
  check('5 목록에 메모 표시', /폴대 하나 수리함/.test(await D.locator('.gear-row[data-id="g1"] .gear-comment').innerText()));
  check('5 목록에 가격·무게·구매일 안 보임', !/50,000원|3kg|2024-01-01/.test(await D.locator('.gear-row[data-id="g4"]').innerText()));
  await D.click('.gear-row[data-id="g4"] [data-action="gear-edit"]');
  check('5 장비 폼: 가격·무게·구매일 칸 없음, 메모 칸 있음', (await D.locator('#gf-price, #gf-weight, #gf-date').count()) === 0 && (await D.locator('textarea#gf-comment').count()) === 1);
  // ================= 3. 브랜드 직접 입력 =================
  check('3 브랜드는 직접 입력하는 칸(목록 고르기 아님)', await D.locator('#gf-brand').evaluate(el => el.tagName === 'INPUT'));
  await D.fill('#gf-brand', 'Yeti');
  await D.fill('#gf-comment', '여름엔 얼음 2봉지');
  await D.click('[data-action="gear-save"]'); await settle();
  const g4 = server['users/uidAlice/gear/g4'];
  check('3·5 직접 쓴 브랜드·메모 저장, 예전 가격·무게·구매일 값은 지우지 않고 보존', g4.brand === 'Yeti' && g4.comment === '여름엔 얼음 2봉지' && g4.price === 50000 && g4.date === '2024-01-01', g4);
  check('5 저장한 메모가 목록에 보임', /여름엔 얼음 2봉지/.test(await D.locator('.gear-row[data-id="g4"]').innerText()));

  // ================= 6. 고른 카테고리가 기본값 =================
  await D.click('.gear-cat-row [data-action="gear-filter"][data-cat="쉘터"]'); await settle();
  check('8 대분류 칩을 고르면 아래 줄에 소분류 칩(쉘터 전체·텐트·타프)', JSON.stringify((await D.locator('.gear-subcat-row [data-action="gear-filter"]').allInnerTexts()).map(t => t.replace(/\s*\d+$/, ''))) === JSON.stringify(['쉘터 전체', '텐트', '타프']));
  await D.click('[data-action="gear-new"]');
  check('6 대분류(쉘터)를 고른 채 장비 추가 → 카테고리 기본값 쉘터', (await D.inputValue('#gf-category')) === '쉘터');
  await D.click('[data-action="modal-close"]');
  await D.click('.gear-subcat-row [data-action="gear-filter"][data-cat="타프"]'); await settle();
  await D.click('[data-action="gear-new"]');
  check('6 소분류(타프)를 고른 채 장비 추가 → 기본값 타프', (await D.inputValue('#gf-category')) === '타프');
  await D.fill('#gf-name', '새 타프');
  await D.click('[data-action="gear-save"]'); await settle();
  check('6 그대로 저장하면 타프로 들어감', Object.values(server).some(v => v && v.name === '새 타프' && v.category === '타프'));
  await D.click('.gear-cat-row [data-action="gear-filter"][data-cat="all"]'); await settle();
  await D.click('[data-action="gear-new"]');
  check('6 전체에서 장비 추가 → 미분류(빈 값)', (await D.inputValue('#gf-category')) === '');
  const groups = await D.locator('#gf-category optgroup').evaluateAll(els => els.map(e => e.label));
  check('8 장비 폼 카테고리는 대분류별 묶음 + 대분류 없음', JSON.stringify(groups) === JSON.stringify(['잠자리', '쉘터', '대분류 없음']), groups);
  await D.click('[data-action="modal-close"]');

  // ================= 2·7·8·9 카테고리 관리 =================
  await openManage(D);
  check('7 "기본값" 잠금 없음: 기타에도 고치기(삭제) 버튼', (await D.locator('#cat-manage-list .tag:has-text("기본값")').count()) === 0 && (await D.locator('#cat-manage-list [data-action="gear-cat-edit"][data-name="기타"]').count()) === 1);
  check('8 관리 창: 대분류 묶음 안에 소분류', JSON.stringify(await D.locator('#cat-manage-list .cat-block').first().locator('.cat-row .cat-name').evaluateAll(els => els.map(e => e.childNodes[0].textContent.trim()))) === JSON.stringify(['잠자리', '침낭']));
  // 2. 순서
  await D.click('#cat-manage-list [data-action="gear-cat-move"][data-name="쉘터"][data-dir="-1"]'); await settle();
  check('2 대분류 순서 바꾸기(쉘터 ↑) 저장', JSON.stringify(meta().majors.map(m => m.name)) === JSON.stringify(['쉘터', '잠자리']), meta().majors);
  check('2 첫 대분류의 ↑ 버튼은 비활성', await D.locator('#cat-manage-list [data-action="gear-cat-move"][data-name="쉘터"][data-dir="-1"]').isDisabled());
  await D.click('#cat-manage-list [data-action="gear-cat-move"][data-name="타프"][data-dir="-1"]'); await settle();
  check('2 소분류 순서 바꾸기(타프 ↑, 같은 대분류 안)', cats().indexOf('타프') < cats().indexOf('텐트'), cats());
  check('2 관리 창이 열린 채로 목록만 바뀜', (await D.locator('#cat-manage-list').count()) === 1);
  // 8. 대분류·소분류 추가
  await D.fill('#cat-new-name', '주방');
  await D.selectOption('#cat-new-parent', '__major');
  await D.click('[data-action="gear-cat-add"]'); await settle();
  await D.fill('#cat-new-name', '버너');
  await D.selectOption('#cat-new-parent', 'm:주방');
  await D.click('[data-action="gear-cat-add"]'); await settle();
  check('8 대분류(주방) 추가 + 그 안에 소분류(버너) 추가', meta().majors.some(m => m.name === '주방') && meta().subs.some(x => x.name === '버너' && x.major === '주방') && cats().includes('버너') && !cats().includes('주방'), { majors: meta().majors, cats: cats() });
  await D.fill('#cat-new-name', '쉘터');
  await D.click('[data-action="gear-cat-add"]'); await settle();
  check('8 대분류와 같은 이름의 소분류는 막음', cats().filter(c => c === '쉘터').length === 0);
  // 9. 설명 + 대분류 옮기기
  await editCat(D, '잠자리');
  await D.fill('#ce-desc', '자는 데 필요한 것');
  await D.click('[data-action="gear-cat-save"]'); await settle();
  check('9 대분류 설명 저장 + 관리 창에 표시', meta().majors.find(m => m.name === '잠자리').desc === '자는 데 필요한 것' && /자는 데 필요한 것/.test(await D.locator('#cat-manage-list').innerText()));
  await editCat(D, '침낭');
  await D.selectOption('#ce-major', '쉘터');
  await D.fill('#ce-desc', '겨울용');
  await D.fill('#ce-name', '침낭류');
  await D.click('[data-action="gear-cat-save"]'); await settle();
  check('8·9 소분류 이름·대분류·설명 한 번에 고치기(장비 카테고리도 바뀜)', meta().subs.some(x => x.name === '침낭류' && x.major === '쉘터' && x.desc === '겨울용') && cats().includes('침낭류') && !cats().includes('침낭')
    && server['users/uidAlice/gear/g3'].category === '침낭류', { subs: meta().subs, g3: server['users/uidAlice/gear/g3'] });
  // 7. 기타 삭제
  await editCat(D, '기타');
  await D.click('[data-action="gear-cat-del"]');
  await D.waitForSelector('[data-action="confirm-yes"]');
  await D.click('[data-action="confirm-yes"]'); await settle();
  check('7 기타도 삭제 가능 → 장비는 미분류로(지우지 않음)', !cats().includes('기타') && server['users/uidAlice/gear/g4'] && server['users/uidAlice/gear/g4'].category === '', { cats: cats(), g4: server['users/uidAlice/gear/g4'] });
  await D.click('[data-action="modal-close"]').catch(() => {}); await settle();
  // 대분류 삭제 → 소분류는 '대분류 없음'으로
  await openManage(D);
  await editCat(D, '주방');
  await D.click('[data-action="gear-cat-del"]');
  await D.click('[data-action="confirm-yes"]'); await settle();
  check('8 대분류 삭제 → 그 소분류(버너)는 남고 대분류 없음으로', !meta().majors.some(m => m.name === '주방') && cats().includes('버너') && !meta().subs.some(x => x.major === '주방'), meta());
  await D.click('[data-action="modal-close"]').catch(() => {}); await settle();
  check('4 바뀐 순서·이름이 목록 묶음에 반영(빈 대분류는 숨김)', JSON.stringify(await secNames(D)) === JSON.stringify(['쉘터', '해먹', '미분류']), await secNames(D));
  check('9 바꾼 소분류 설명이 목록에 보임', /겨울용/.test(await D.locator('.gear-sec:has(.gear-sec-name:text-is("쉘터"))').innerText()));

  // ================= Home 통계: 대분류 기준 =================
  await nav(D, 'home'); await settle();
  const legend = await D.locator('.stat-card:has-text("보유 장비") .legend-row .lv').allInnerTexts();
  check('Home 장비 통계는 맨 위 묶음(대분류) 기준', legend.includes('쉘터') && !legend.includes('텐트'), legend);
  await D.locator('.stat-card:has-text("보유 장비") .legend-row:has-text("쉘터")').click(); await settle();
  check('Home에서 대분류를 누르면 Gear 탭의 그 대분류 칩', (await D.locator('.gear-cat-row .seg-btn.active').innerText()).startsWith('쉘터'));

  // ================= 7. 저장한 적 없는 사람: 기본 목록 대신 쓰는 카테고리만 =================
  await nav(B, 'gear'); await settle();
  await openManage(B);
  const bCats = await B.locator('#cat-manage-list .cat-name').evaluateAll(els => els.map(e => e.childNodes[0].textContent.trim()));
  check('7 카테고리를 저장한 적 없는 사람: 기본 목록(기타·조명…) 없이 장비에 쓰인 것만', JSON.stringify(bCats) === JSON.stringify(['텐트', '조리용품']), bCats);
  await B.click('[data-action="modal-close"]');

  // ================= 8. 그룹 공간: 대분류는 그룹 문서에 =================
  await nav(D, 'gear');
  await pickSpace(D, '캠핑팸');
  if (await D.locator('[data-action="space-note-ok"]').count()) await D.click('[data-action="space-note-ok"]');
  await openManage(D);
  await D.fill('#cat-new-name', '집');
  await D.selectOption('#cat-new-parent', '__major');
  await D.click('[data-action="gear-cat-add"]'); await settle();
  await editCat(D, '텐트');
  await D.selectOption('#ce-major', '집');
  await D.click('[data-action="gear-cat-save"]'); await settle();
  const gdoc = server['groups/grpFam'];
  check('8 그룹 공간: 대분류·소분류는 그룹 문서(gearCategoryMeta)에 저장, 개인 설정은 그대로', gdoc.gearCategoryMeta && gdoc.gearCategoryMeta.majors.some(m => m.name === '집') && gdoc.gearCategoryMeta.subs.some(x => x.name === '텐트' && x.major === '집')
    && !meta().majors.some(m => m.name === '집'), gdoc.gearCategoryMeta);
  await D.click('[data-action="modal-close"]'); await settle();
  await nav(B, 'gear');
  await pickSpace(B, '캠핑팸');
  if (await B.locator('[data-action="space-note-ok"]').count()) await B.click('[data-action="space-note-ok"]');
  await B.waitForSelector('.gear-sec-name:text-is("집")', { timeout: 3000 }).catch(() => {});
  check('8 다른 멤버(밥) 화면에도 그룹 대분류로 묶여 보임', JSON.stringify(await secNames(B)) === JSON.stringify(['집']), await secNames(B));

  // 휴대폰: 카테고리 관리 버튼 누르는 영역
  const M = await phone(UA, { mobile: true });
  await nav(M, 'gear'); await settle();
  await openManage(M);
  const btnSizes = await M.locator('#cat-manage-list .icon-btn').evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  check('390px 카테고리 관리: 화살표·연필 버튼 40×40 이상, 가로 넘침 없음', btnSizes.length > 0 && btnSizes.every(v => v >= 40)
    && await M.evaluate(() => { const m = document.querySelector('#modal-root .modal'); return m.scrollWidth <= m.clientWidth + 1; }), btnSizes);

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
