// J. 템플릿 페이지·새 리스트에서 템플릿·Gear 카테고리별 +·Home 장비 통계 삭제 테스트 (가짜 Firestore/Auth):
//  1 카테고리 묶음·소분류의 + → 그 카테고리로 장비 추가, 2 템플릿 페이지(리스트 없이 만들기·항목 추가·빼기+되돌리기·이름·삭제,
//  그룹은 만든 사람만 고치기, 예전 템플릿은 누구나, 이 템플릿으로 새 리스트), 3 새 리스트 창에서 템플릿 불러오기, 4 Home·Settings에 보유 장비 통계 없음
// 실행: node tests/template-j.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick, gearAction } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-tplj-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8780;

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
  server[A + 'settings/app'] = { gearCategories: ['텐트', '타프', '조리용품'], homeWidgets: { nextTrip: true, camping: true, gear: true, checklist: true },
    gearCategoryMeta: { majors: [{ name: '쉘터', desc: '' }], subs: [{ name: '텐트', major: '쉘터', desc: '' }, { name: '타프', major: '쉘터', desc: '' }] } };
  server[A + 'gear/g1'] = { name: '스텔스 텐트', brand: 'B', category: '텐트' };
  server[A + 'gear/g2'] = { name: '버너', brand: 'B', category: '조리용품' };
  server[A + 'gear/g3'] = { name: '분류 없는 것', brand: '', category: '' };
  server[A + 'trips/t1'] = { title: '가을 캠핑', startDate: '2099-10-01', endDate: '2099-10-02', campsiteName: '', region: '', createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  server[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob'], createdAt: '1', gearCategories: [],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member') } };
  server[G + '/checklistTemplates/old'] = { title: '예전 템플릿', items: [{ label: '물', group: '음식' }] };   // createdBy 없음
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
  const tplDocs = base => Object.entries(server).filter(([k]) => k.startsWith(base + 'checklistTemplates/')).map(([k, v]) => ({ id: k.split('/').pop(), ...v }));
  const openTplPage = async p => { await nav(p, 'checklist'); await settle(); await p.click('[data-action="trip-pick"][data-trip="__tpl"]'); await settle(); };

  // ================= 4. Home·Settings: 보유 장비 통계 없음 =================
  await nav(D, 'home'); await settle();
  check('4 Home에 보유 장비 통계 없음(예전에 켜 둔 값이 있어도)', (await D.locator('.stat-card:has-text("보유 장비")').count()) === 0 && (await D.locator('.stat-card:has-text("캠핑 기록")').count()) === 1);
  await nav(D, 'settings'); await settle();
  check('4 Settings 위젯 켜기/끄기에도 "보유 장비 통계" 없음', !/보유 장비 통계/.test(await D.locator('#main').innerText()) && /캠핑 기록 통계/.test(await D.locator('#main').innerText()));

  // ================= 1. Gear 카테고리별 + =================
  await nav(D, 'gear'); await settle();
  check('1 카테고리 묶음마다 + 버튼(aria-label, 40×40)', (await D.locator('.gear-sec-top .gear-sec-add').count()) === (await D.locator('.gear-sec').count())
    && await D.locator('.gear-sec-add').first().evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 40 && r.height >= 40 && /장비 추가/.test(el.getAttribute('aria-label')); }));
  await D.click('.gear-sec:has(.gear-sec-name:text-is("조리용품")) .gear-sec-add');
  check('1 묶음의 + → 그 카테고리(조리용품)가 골라진 장비 추가 창', (await D.inputValue('#gf-category')) === '조리용품');
  await D.fill('#gf-name', '코펠'); await D.click('[data-action="gear-save"]'); await settle();
  check('1 그대로 저장하면 조리용품으로', Object.values(server).some(v => v && v.name === '코펠' && v.category === '조리용품'));
  await D.click('.gear-sub-head:has(.gear-sub-name:text-is("텐트")) .gear-sub-add');
  check('1 대분류 안 소분류(텐트) 제목의 + → 텐트', (await D.inputValue('#gf-category')) === '텐트');
  await D.click('[data-action="modal-close"]'); await settle();
  await D.click('.gear-sec:has(.gear-sec-name:text-is("쉘터")) .gear-sec-add');
  check('1 대분류(쉘터) 묶음의 + → 쉘터', (await D.inputValue('#gf-category')) === '쉘터');
  await D.click('[data-action="modal-close"]'); await settle();
  await D.click('.gear-sec:has(.gear-sec-name:text-is("미분류")) .gear-sec-add');
  check('1 미분류 묶음의 + → 미분류(빈 값)', (await D.inputValue('#gf-category')) === '');
  await D.click('[data-action="modal-close"]'); await settle();
  await D.click('[data-action="gear-select"]');
  check('1 선택 모드에서는 + 버튼 숨김', (await D.locator('.gear-sec-add, .gear-sub-add').count()) === 0);
  await D.click('[data-action="gear-select-cancel"]');

  // ================= 2. 템플릿 페이지(개인) =================
  await openTplPage(D);
  check('2 Checklist 일정 줄의 "템플릿" 칩 → 템플릿 페이지(새 템플릿 버튼)', await D.locator('[data-action="tpl-new"]').isVisible() && /아직 템플릿이 없어요/.test(await D.locator('#main').innerText()));
  await D.click('[data-action="tpl-new"]');
  await D.fill('#tpl-title', '여름 기본');
  await D.fill('#tpl-items', '텐트: 텐트\n텐트: 타프\n랜턴\n랜턴');
  await D.click('[data-action="tpl-save"]'); await settle();
  const mine = tplDocs('users/uidAlice/')[0];
  check('2 리스트 없이 템플릿 만들기("소분류: 항목", 중복 한 번만, createdBy=나)', mine && mine.title === '여름 기본' && mine.createdBy === 'uidAlice'
    && JSON.stringify(mine.items) === JSON.stringify([{ label: '텐트', group: '텐트' }, { label: '타프', group: '텐트' }, { label: '랜턴', group: '기타' }]), mine);
  await D.click(`.tpl-card[data-tpl="${mine.id}"] [data-action="tpl-add-item"]`);
  await D.fill('#tpi-labels', '버너\n코펠');
  await D.fill('#tpi-group', '조리');
  await D.click('[data-action="tpl-add-item-save"]'); await settle();
  check('2 템플릿에 항목 추가(소분류 지정)', server['users/uidAlice/checklistTemplates/' + mine.id].items.filter(i => i.group === '조리').length === 2);
  await D.click(`.tpl-card[data-tpl="${mine.id}"] .tpl-item:has-text("타프") [data-action="tpl-item-del"]`); await settle();
  check('2 항목 빼기 + 되돌리기 토스트', !server['users/uidAlice/checklistTemplates/' + mine.id].items.some(i => i.label === '타프') && (await D.locator('#toast [data-action="undo-delete"]').count()) === 1);
  await D.click('#toast [data-action="undo-delete"]'); await settle();
  check('2 되돌리면 원래 자리로', server['users/uidAlice/checklistTemplates/' + mine.id].items[1].label === '타프');

  // ================= 3. 새 리스트에서 템플릿 불러오기 =================
  await D.click('[data-action="trip-pick"][data-trip="all"]'); await settle();
  await D.click('[data-action="cl-new-list"]');
  check('3 새 리스트 창에 "템플릿에서 불러오기"(기본은 빈 리스트)', (await D.inputValue('#ncl-tpl')) === '' && (await D.locator('#ncl-tpl option').count()) === 2);
  await D.selectOption('#ncl-tpl', mine.id);
  check('3 템플릿을 고르면 비어 있던 이름 칸에 템플릿 이름', (await D.inputValue('#ncl-title')) === '여름 기본');
  await D.fill('#ncl-title', '이번 주 준비물');
  await D.click('[data-action="cl-new-list-save"]'); await settle();
  const nl = Object.values(server).find(v => v && v.title === '이번 주 준비물');
  check('3 입력한 이름 + 템플릿 항목(모두 미정, 소분류 그대로)', nl && nl.items.length === 5 && nl.items.every(i => i.status === 'pending' && i.id) && nl.items.find(i => i.label === '버너').group === '조리' && !nl.tripId, nl);
  await D.locator('.trip-chip:has-text("가을 캠핑")').first().click(); await settle();
  await D.click('.trip-panel .tp-add-list');
  await D.selectOption('#ncl-tpl', mine.id);
  await D.click('[data-action="cl-new-list-save"]'); await settle();
  check('3 일정을 보는 중이면 그 일정에 연결', Object.values(server).some(v => v && v.title === '여름 기본' && v.tripId === 't1' && (v.items || []).length === 5));
  await D.click('[data-action="trip-pick"][data-trip="all"]'); await settle();
  await D.click('[data-action="cl-new-list"]');
  await D.fill('#ncl-title', '빈 것');
  await D.click('[data-action="cl-new-list-save"]'); await settle();
  check('3 템플릿을 안 고르면 빈 리스트', Object.values(server).some(v => v && v.title === '빈 것' && Array.isArray(v.items) && v.items.length === 0));

  // ================= 2. 그룹 템플릿: 만든 사람만 고치기 =================
  await openTplPage(D);
  await D.locator('.space-chip:has-text("캠핑팸")').first().click(); await settle();
  if (await D.locator('[data-action="space-note-ok"]').count()) await D.click('[data-action="space-note-ok"]');
  await D.click('[data-action="trip-pick"][data-trip="__tpl"]'); await settle();
  await D.click('[data-action="tpl-new"]');
  await D.fill('#tpl-title', '앨리스 세트');
  await D.fill('#tpl-items', '의자');
  await D.click('[data-action="tpl-save"]'); await settle();
  const at = tplDocs('groups/grpFam/').find(t => t.title === '앨리스 세트');
  check('2 그룹 템플릿 저장(createdBy=앨리스)', at && at.createdBy === 'uidAlice', at);
  await nav(B, 'checklist');
  await B.locator('.space-chip:has-text("캠핑팸")').first().click(); await settle();
  if (await B.locator('[data-action="space-note-ok"]').count()) await B.click('[data-action="space-note-ok"]');
  await B.click('[data-action="trip-pick"][data-trip="__tpl"]'); await settle();
  const aCard = B.locator(`.tpl-card[data-tpl="${at.id}"]`);
  const aMenu = await aCard.locator('.more-item').evaluateAll(els => els.map(e => e.dataset.action));
  check('2 다른 멤버(밥): 남의 템플릿은 "보기 전용" + 만든 사람 표시, 항목 추가·빼기·이름·삭제 없음, "새 리스트"만', /보기 전용/.test(await aCard.innerText()) && /앨리스/.test(await aCard.locator('.tpl-owner').innerText())
    && (await aCard.locator('[data-action="tpl-add-item"], [data-action="tpl-item-del"]').count()) === 0 && JSON.stringify(aMenu) === JSON.stringify(['tpl-make-list']), aMenu);
  const oCard = B.locator('.tpl-card[data-tpl="old"]');
  check('2 만든 사람 기록이 없는 예전 템플릿은 밥도 고칠 수 있음', (await oCard.locator('[data-action="tpl-add-item"]').count()) === 1);
  await B.click('.tpl-card[data-tpl="old"] [data-action="tpl-add-item"]');
  await B.fill('#tpi-labels', '컵');
  await B.click('[data-action="tpl-add-item-save"]'); await settle();
  check('2 예전 템플릿 고치기 저장(만든 사람 기록은 그대로 없음)', server['groups/grpFam/checklistTemplates/old'].items.length === 2 && !('createdBy' in server['groups/grpFam/checklistTemplates/old']));
  await menuClick(B, `.tpl-card[data-tpl="${at.id}"] [data-action="tpl-make-list"]`); await settle();
  check('2 남의 템플릿으로 새 리스트 만들기는 됨', Object.entries(server).some(([k, v]) => k.startsWith('groups/grpFam/checklists/') && v.title === '앨리스 세트' && v.items.length === 1));

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
