// K. 템플릿 하위 메뉴 + 장비에서 템플릿 만들기 테스트 (가짜 Firestore/Auth):
//  1 왼쪽 메뉴 Checklist 아래 "템플릿"(데스크톱), 휴대폰은 Checklist 탭 켜진 채 "템플릿" 칩, 다른 기기 변경 바로 반영
//  2 새 템플릿 = 장비에서 고르기(기본, 카테고리별·전체 선택) / 직접 입력, 템플릿 ⋯ "장비에서 불러오기"(이미 있는 이름 제외), 그룹은 만든 사람만
// 실행: node tests/template-k.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick, gearAction } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-tplk-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8781;

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
  server[A + 'settings/app'] = { gearCategories: ['텐트', '타프', '조리용품'], homeWidgets: { nextTrip: true, camping: true, checklist: true },
    gearCategoryMeta: { majors: [{ name: '쉘터', desc: '' }], subs: [{ name: '텐트', major: '쉘터', desc: '' }, { name: '타프', major: '쉘터', desc: '' }] } };
  server[A + 'gear/g1'] = { name: '스텔스 텐트', brand: 'B', category: '텐트' };
  server[A + 'gear/g2'] = { name: '렉타 타프', brand: 'B', category: '타프' };
  server[A + 'gear/g3'] = { name: '버너', brand: 'B', category: '조리용품' };
  server[A + 'gear/g4'] = { name: '랜턴', brand: '', category: '' };
  server[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob'], createdAt: '1', gearCategories: ['텐트'],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member') } };
  server[G + '/gear/gg1'] = { name: '그룹 텐트', brand: 'C', category: '텐트' };
  server[G + '/checklistTemplates/bobs'] = { title: '밥 세트', createdBy: 'uidBob', items: [{ label: '물', group: '음식' }] };
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
  const M = await phone(UA, { mobile: true });
  const B = await phone(UB);
  const tplOf = (base, title) => { const e = Object.entries(server).find(([k, v]) => k.startsWith(base + 'checklistTemplates/') && v.title === title); return e ? { id: e[0].split('/').pop(), ...e[1] } : null; };

  // ================= 1. 왼쪽 메뉴 Checklist 아래 "템플릿" =================
  const navOrder = await D.locator('#nav [data-nav]').evaluateAll(els => els.map(e => e.dataset.nav + (e.classList.contains('nav-sub') ? '*' : '')));
  check('1 데스크톱 왼쪽 메뉴: Checklist 바로 아래 하위 메뉴 "템플릿"', navOrder.indexOf('templates*') === navOrder.indexOf('checklist') + 1, navOrder);
  await D.click('#nav [data-nav="templates"]'); await settle();
  check('1 누르면 템플릿 화면(제목 "템플릿", 하위 메뉴만 켜짐, 공간 칩 있음)', (await D.locator('#view-title').innerText()) === '템플릿' && (await D.locator('#nav [data-nav="templates"].active').count()) === 1
    && (await D.locator('#nav [data-nav="checklist"].active').count()) === 0 && (await D.locator('.space-chip').count()) >= 2 && await D.locator('[data-action="tpl-new"]').isVisible());
  check('1 휴대폰 탭바는 6개 그대로(템플릿 탭 없음)', (await M.locator('#mobile-tabbar [data-nav]').count()) === 6 && (await M.locator('#mobile-tabbar [data-nav="templates"]').count()) === 0);
  await nav(M, 'checklist'); await settle();
  await M.click('[data-action="go-templates"]'); await settle();
  check('1 휴대폰: Checklist의 "템플릿" 칩 → 템플릿 화면, 탭바는 Checklist가 켜진 채', await M.locator('[data-action="tpl-new"]').isVisible() && (await M.locator('#mobile-tabbar [data-nav="checklist"].active').count()) === 1);

  // ================= 2. 새 템플릿: 장비에서 고르기 =================
  await D.click('[data-action="tpl-new"]');
  check('2 새 템플릿 창: 장비가 있으면 "장비에서 고르기"가 기본, 직접 입력 칸은 숨김', (await D.locator('#tpl-start-method .seg-btn.active[data-val="gear"]').count()) === 1 && !(await D.locator('#tpl-items').isVisible()));
  await D.fill('#tpl-title', '오토캠핑 기본');
  await D.click('[data-action="tpl-save"]'); await settle();
  check('2 만들면 바로 장비 고르기 창(템플릿 이름, 카테고리 묶음)', /오토캠핑 기본/.test(await D.locator('#modal-root').innerText()) && JSON.stringify(await D.locator('#modal-root .gpk-sec-row .sr-name').allInnerTexts()) === JSON.stringify(['쉘터', '조리용품', '미분류']));
  await D.click('#gpk-all');
  await D.click('.gpk-row:has-text("랜턴") input');
  await D.click('[data-action="gpk-go"]'); await settle();
  const t1 = tplOf('users/uidAlice/', '오토캠핑 기본');
  check('2 고른 장비가 템플릿 항목으로({label, group}만, 카테고리 = 소분류)', t1 && JSON.stringify(t1.items) === JSON.stringify([{ label: '스텔스 텐트', group: '텐트' }, { label: '렉타 타프', group: '타프' }, { label: '버너', group: '조리용품' }]) && t1.createdBy === 'uidAlice', t1);
  check('2 템플릿 화면에 바로 보임', /스텔스 텐트/.test(await D.locator(`.tpl-card[data-tpl="${t1.id}"]`).innerText()));
  await M.waitForSelector(`.tpl-card[data-tpl="${t1.id}"]`, { timeout: 3000 }).catch(() => {});
  check('1 같은 계정 다른 기기(휴대폰) 템플릿 화면에도 바로 반영', (await M.locator(`.tpl-card[data-tpl="${t1.id}"]`).count()) === 1);
  await menuClick(D, `.tpl-card[data-tpl="${t1.id}"] [data-action="tpl-gear-import"]`);
  check('2 템플릿 ⋯ "장비에서 불러오기": 이미 있는 3개는 "이미 있음", 남은 건 랜턴만', (await D.locator('#modal-root .gpk-row.is-dup').count()) === 3 && (await D.locator('#modal-root .gpk-item:not(:disabled)').count()) === 1);
  await D.click('#gpk-all'); await D.click('[data-action="gpk-go"]'); await settle();
  check('2 더 불러오면 그 항목만 추가(랜턴 → 기타)', server['users/uidAlice/checklistTemplates/' + t1.id].items.length === 4 && server['users/uidAlice/checklistTemplates/' + t1.id].items[3].group === '기타');
  await D.click('[data-action="tpl-new"]');
  await D.click('[data-action="tpl-start-pick"][data-val="text"]');
  await D.fill('#tpl-title', '손으로 쓴 것');
  await D.fill('#tpl-items', '조리: 코펠\n물');
  await D.click('[data-action="tpl-save"]'); await settle();
  check('2 "직접 입력"은 예전처럼(장비 고르기 창 안 뜸)', (await D.locator('#modal-root .gpk-list').count()) === 0 && tplOf('users/uidAlice/', '손으로 쓴 것').items.length === 2);
  await menuClick(D, `.tpl-card[data-tpl="${t1.id}"] [data-action="tpl-make-list"]`); await settle();
  check('2 "이 템플릿으로 새 리스트" → Checklist 화면으로, 항목 4개', (await D.locator('#view-title').innerText()) === 'Checklist' && Object.values(server).some(v => v && v.title === '오토캠핑 기본' && Array.isArray(v.items) && v.items.length === 4 && v.items.every(i => i.status === 'pending')));

  // ================= 그룹: 남의 템플릿에는 장비 불러오기 없음, 내 것은 그룹/내 장비 =================
  await D.click('#nav [data-nav="templates"]'); await settle();
  await D.locator('.space-chip:has-text("캠핑팸")').first().click(); await settle();
  if (await D.locator('[data-action="space-note-ok"]').count()) await D.click('[data-action="space-note-ok"]');
  const bobMenu = await D.locator('.tpl-card[data-tpl="bobs"] .more-item').evaluateAll(els => els.map(e => e.dataset.action));
  check('2 그룹: 남(밥)의 템플릿 메뉴에 "장비에서 불러오기" 없음', JSON.stringify(bobMenu) === JSON.stringify(['tpl-make-list']), bobMenu);
  await D.click('[data-action="tpl-new"]');
  check('2 그룹 공간: 그룹 장비가 있으면 장비에서 고르기 기본', (await D.locator('#tpl-start-method .seg-btn.active[data-val="gear"]').count()) === 1);
  await D.fill('#tpl-title', '팸 세트');
  await D.click('[data-action="tpl-save"]'); await settle();
  await D.click('[data-action="gpk-src"][data-src="me"]');
  await D.click('#modal-root .gpk-row:has-text("버너") input');
  await D.click('[data-action="gpk-go"]'); await settle();
  const gt = tplOf('groups/grpFam/', '팸 세트');
  check('2 그룹 템플릿: 내 장비에서도 고를 수 있고 담당자 없이 {label, group}', gt && gt.createdBy === 'uidAlice' && JSON.stringify(gt.items) === JSON.stringify([{ label: '버너', group: '조리용품' }]), gt);
  await nav(B, 'checklist');
  await B.locator('.space-chip:has-text("캠핑팸")').first().click(); await settle();
  if (await B.locator('[data-action="space-note-ok"]').count()) await B.click('[data-action="space-note-ok"]');
  await B.click('[data-action="go-templates"]'); await settle();
  await B.waitForSelector(`.tpl-card[data-tpl="${gt.id}"]`, { timeout: 3000 }).catch(() => {});
  check('2 다른 멤버 화면에도 바로 보임(보기 전용)', /보기 전용/.test(await B.locator(`.tpl-card[data-tpl="${gt.id}"]`).innerText().catch(() => '')));

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
