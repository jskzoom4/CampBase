// Q. 사이트 배치 테스트 (가짜 Firestore/Auth):
//  장비 폼의 배치용 크기(저장·수정·비우기·하나만 막기·종류 기본값·목록 표시·그룹으로 보내기·백업), parseSiteSize, 후기에서 불러오기로 배치 만들기,
//  Gear 하위 메뉴(데스크톱 왼쪽·휴대폰 하위 탭)·공간 칩·빈 화면, 장비 놓기(크기 있는 것만·크기 입력으로 이어가기·직접 추가·빠른 칩),
//  끌기(포인터)·0.1m 맞춤·회전·위치 입력·빼기(되돌리기)·키보드, 판정 규칙, 자동 배치(가능·어려움+부족 안내·되돌리기·시간),
//  그룹(실시간·동시 수정·내 장비 놓기·비멤버 거부·그룹 삭제 정리·그룹 백업 왕복), 연결(일정 패널 ⋯·캠핑 기록·일정 삭제), 390px 도구 막대
// 실행: node tests/layouts-q.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick, gearAction } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-layoutq-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8783;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const UC = { uid: 'uidCarol', displayName: '캐롤', email: 'carol@example.com', photoURL: '' };
const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const A = 'users/uidAlice/', G = 'groups/grpFam';
const server = {};
(function seed() {
  const mem = (n, r) => ({ name: n, photoURL: '', role: r });
  server[A + 'settings/app'] = { gearCategories: ['텐트', '타프', '체어'], homeWidgets: { nextTrip: true, camping: true, checklist: true } };
  server[A + 'gear/g1'] = { name: '리빙쉘', brand: 'Snow Peak', category: '텐트', footprint: { kind: 'tent', w: 4.5, d: 3.0, shape: 'rect', guy: 0.5 } };
  server[A + 'gear/g2'] = { name: '돔텐트', brand: 'Coleman', category: '텐트', footprint: { kind: 'tent', w: 2.7, d: 2.4, shape: 'rect', guy: 0.5 } };
  server[A + 'gear/g3'] = { name: '렉타 타프', brand: 'DOD', category: '타프', footprint: { kind: 'tarp', w: 3, d: 3, shape: 'rect' } };
  server[A + 'gear/g4'] = { name: '릴렉스 체어', brand: 'Helinox', category: '체어' };
  server[A + 'gear/g5'] = { name: '원터치 텐트', brand: '', category: '텐트' };
  server[A + 'campingLogs/c1'] = { name: '홍천 강변 캠핑장', date: '2026-08-16', region: '홍천', siteType: '데크', siteSize: '6x8m', rating: 4, notes: '' };
  server[A + 'campingLogs/c2'] = { name: '가평 숲속 야영장', date: '2026-05-02', region: '가평', siteType: '흙', siteSize: '20평', rating: 5, notes: '' };
  server[A + 'trips/t1'] = { title: '홍천 가을 캠핑', startDate: ymd(6), endDate: ymd(7), campsiteName: '홍천 강변 캠핑장', region: '홍천', createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  server[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob'], createdAt: '1', gearCategories: ['텐트'],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member') } };
  server[G + '/gear/gg1'] = { name: '그룹 텐트', brand: 'Coleman', category: '텐트', ownerUid: 'uidBob', addedBy: 'uidBob', footprint: { kind: 'tent', w: 3, d: 3, shape: 'rect', guy: 0.5 } };
  server[G + '/gear/gg2'] = { name: '그룹 타프', brand: '', category: '', addedBy: 'uidBob', footprint: { kind: 'tarp', w: 4, d: 4, shape: 'rect' } };
  server[G + '/trips/gt'] = { title: '팸 캠핑', startDate: ymd(3), endDate: ymd(4), campsiteName: '', region: '', memberUids: ['uidAlice', 'uidBob'], createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
})();

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });
  await sleep(700);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const pages = [];
  async function phone(user, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, hasTouch: !!opts.mobile });
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
  const settle = (ms) => sleep(ms || 350);
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const pickSpace = async (p, label) => { await p.locator(`.space-chip:has-text("${label}")`).first().click(); await settle(); if (await p.locator('[data-action="space-note-ok"]').count()) { await p.click('[data-action="space-note-ok"]'); await settle(); } };
  const layoutsOf = base => Object.entries(server).filter(([k]) => k.startsWith(base + 'layouts/') && k.split('/').length === base.split('/').length + 1).map(([k, v]) => ({ id: k.split('/').pop(), ...v }));
  const layoutBy = (base, title) => layoutsOf(base).find(l => l.title === title);
  const toastText = p => p.locator('#toast').innerText();
  const goLayouts = async p => { await p.locator('#nav [data-nav="layouts"]:visible, .sub-tab[data-view="layouts"]:visible').first().click(); await settle(); };

  const D = await phone(UA);

  // ================= 1. parseSiteSize =================
  const parsed = await D.evaluate(() => ['5x5m', '5 × 6', '6*8', '6m x 8m', '5.5x7', '6X8', '20평', '', '넓음', '0x5', '6 x 8 m'].map(s => parseSiteSize(s)));
  check('1 parseSiteSize: 5x5m·5 × 6·6*8·6m x 8m·5.5x7·6X8 → {w,d}', JSON.stringify(parsed.slice(0, 6)) === JSON.stringify([{ w: 5, d: 5 }, { w: 5, d: 6 }, { w: 6, d: 8 }, { w: 6, d: 8 }, { w: 5.5, d: 7 }, { w: 6, d: 8 }]), parsed);
  check('1 parseSiteSize: "20평"·빈 글·"넓음"·0 → null, "6 x 8 m"도 읽음', parsed[6] === null && parsed[7] === null && parsed[8] === null && parsed[9] === null && JSON.stringify(parsed[10]) === JSON.stringify({ w: 6, d: 8 }), parsed.slice(6));

  // ================= 2. 장비 폼: 배치용 크기 =================
  await nav(D, 'gear'); await settle();
  check('2 장비 목록 줄 설명 끝에 크기 "2.7×2.4m"(있을 때만)', /2\.7×2\.4m/.test(await D.locator('.gear-row[data-id="g2"] .meta').innerText()) && (await D.locator('.gear-row[data-id="g4"] .fp-size').count()) === 0);
  await D.click('[data-action="gear-new"]'); await settle(200);
  check('2 장비 추가 창에 "사이트 배치용 크기" 묶음(설명·종류·가로×세로·모양·스트링 여유, 숫자 키패드)', /사이트 배치용 크기/.test(await D.locator('#modal-root').innerText())
    && (await D.locator('#gf-fp-w[inputmode="decimal"], #gf-fp-d[inputmode="decimal"], #gf-fp-guy[inputmode="decimal"]').count()) === 3
    && (await D.locator('[data-action="gf-fp-kind"]').count()) === 3 && (await D.locator('[data-action="gf-fp-shape"]').count()) === 2
    && /보통 텐트 0\.5~1m, 타프 1\.5~2m/.test(await D.locator('#modal-root').innerText()));
  await D.selectOption('#gf-category', '타프'); await settle(100);
  check('2 종류 기본값: 카테고리 "타프" → 타프', (await D.inputValue('#gf-fp-kind')) === 'tarp' && await D.locator('[data-action="gf-fp-kind"][data-val="tarp"].active').count() === 1);
  await D.selectOption('#gf-category', '텐트'); await settle(100);
  check('2 종류 기본값: 카테고리 "텐트" → 텐트·쉘터', (await D.inputValue('#gf-fp-kind')) === 'tent');
  await D.selectOption('#gf-category', '체어'); await settle(100);
  check('2 종류 기본값: 그 밖 → 기타', (await D.inputValue('#gf-fp-kind')) === 'item');
  await D.fill('#gf-name', '헥사 타프');
  await D.selectOption('#gf-category', '타프');
  await D.fill('#gf-fp-w', '4.2');
  await D.click('[data-action="gear-save"]'); await settle();
  const hexa = () => Object.entries(server).find(([k, v]) => k.startsWith(A + 'gear/') && v.name === '헥사 타프');
  check('2 가로만 쓰면 저장 막고 안내', !hexa() && /둘 다/.test(await toastText(D)) && await D.locator('#modal-root #gf-name').count() === 1);
  await D.fill('#gf-fp-d', '4.6'); await D.click('[data-action="gf-fp-shape"][data-val="round"]'); await D.fill('#gf-fp-guy', '1.5');
  await D.click('[data-action="gear-save"]'); await settle();
  check('2 저장: footprint { kind tarp, w 4.2, d 4.6, shape round, guy 1.5 }', hexa() && JSON.stringify(hexa()[1].footprint) === JSON.stringify({ kind: 'tarp', w: 4.2, d: 4.6, shape: 'round', guy: 1.5 }), hexa() && hexa()[1]);
  const hexaId = hexa()[0].split('/').pop();
  await D.click(`[data-action="gear-edit"][data-id="${hexaId}"]`); await settle(200);
  check('2 수정 창에 값이 채워짐', (await D.inputValue('#gf-fp-w')) === '4.2' && (await D.inputValue('#gf-fp-d')) === '4.6' && (await D.inputValue('#gf-fp-shape')) === 'round' && (await D.inputValue('#gf-fp-guy')) === '1.5');
  await D.fill('#gf-fp-w', '5'); await D.fill('#gf-comment', '메모');
  await D.click('[data-action="gear-save"]'); await settle();
  check('2 수정: 크기만 바뀌고 다른 필드 유지', hexa()[1].footprint.w === 5 && hexa()[1].comment === '메모' && hexa()[1].brand === '' && hexa()[1].category === '타프');
  await D.click(`[data-action="gear-edit"][data-id="${hexaId}"]`); await settle(200);
  await D.fill('#gf-fp-w', ''); await D.fill('#gf-fp-d', '');
  await D.click('[data-action="gear-save"]'); await settle();
  check('2 가로·세로를 둘 다 비우면 footprint 삭제', hexa() && !('footprint' in hexa()[1]) && hexa()[1].comment === '메모');
  // 그룹으로 보내기·백업: footprint 그대로
  await gearAction(D, 'gear-send', ['g2']); await settle(200);
  await D.click('[data-action="gear-send-go"]'); await settle();
  const sent = Object.entries(server).find(([k, v]) => k.startsWith(G + '/gear/') && v.name === '돔텐트');
  check('2 그룹으로 보내기: footprint도 복사', sent && JSON.stringify(sent[1].footprint) === JSON.stringify(server[A + 'gear/g2'].footprint), sent && sent[1]);
  const bk = await D.evaluate(() => buildBackup());
  check('2 개인 백업에 장비 footprint·layouts 포함', bk.gear.find(g => g.id === 'g1').footprint.w === 4.5 && Array.isArray(bk.layouts));

  // ================= 3. Gear 하위 메뉴 =================
  const navOrder = await D.locator('#nav [data-nav]').evaluateAll(els => els.map(e => e.dataset.nav + (e.classList.contains('nav-sub') ? '*' : '')));
  check('3 데스크톱 왼쪽 메뉴: Gear 바로 아래 하위 메뉴 "사이트 배치" + 화살표', navOrder.indexOf('layouts*') === navOrder.indexOf('gear') + 1 && await D.locator('#nav [data-action="nav-sub-toggle"][data-id="gear"]').count() === 1, navOrder);
  await D.click('#nav [data-nav="layouts"]'); await settle();
  check('3 누르면 사이트 배치 화면(제목, 하위 메뉴만 켜짐, 공간 칩)', (await D.locator('#view-title').innerText()) === '사이트 배치' && (await D.locator('#nav [data-nav="layouts"].active').count()) === 1
    && (await D.locator('#nav [data-nav="gear"].active').count()) === 0 && (await D.locator('.space-chip').count()) >= 2);
  check('3 비었을 때: 안내 + "배치 만들기"(앰버) + 후기에서 불러오기 파선 카드', /사이트 크기에 우리 텐트가 들어가는지 미리 놓아 봐요/.test(await D.locator('#main').innerText())
    && await D.locator('.lo-empty [data-action="lo-new"].btn-accent').count() === 1 && await D.locator('[data-action="lo-from-log"]').isVisible()
    && /지난 캠핑 후기의 사이트 크기로 시작할 수 있어요/.test(await D.locator('[data-action="lo-from-log"]').innerText()));

  // ================= 4. 후기에서 불러오기로 배치 만들기 =================
  await D.click('[data-action="lo-from-log"]'); await settle(200);
  check('4 배치 만들기 창: 후기 목록(이름·날짜·크기, 못 읽으면 "크기 직접 입력"), 진입로 기본 아래', await D.locator('#lf-log').count() === 1
    && /홍천 강변 캠핑장 · 2026-08-16 · 6\.0 × 8\.0m/.test(await D.locator('#lf-log').innerText()) && /가평 숲속 야영장 · 2026-05-02 · 크기 직접 입력/.test(await D.locator('#lf-log').innerText())
    && (await D.inputValue('#lf-ent')) === 'bottom' && (await D.inputValue('#lf-title')) === '새 배치');
  await D.selectOption('#lf-log', 'c2'); await settle(100);
  check('4 크기를 못 읽는 후기 → 안내', /읽지 못했어요/.test(await D.locator('#lf-size-hint').innerText()) && (await D.inputValue('#lf-w')) === '');
  await D.selectOption('#lf-log', 'c1'); await settle(100);
  check('4 후기를 고르면 이름·크기·바닥 종류 채움', (await D.inputValue('#lf-title')) === '홍천 강변 캠핑장' && (await D.inputValue('#lf-w')) === '6.0' && (await D.inputValue('#lf-d')) === '8.0'
    && (await D.inputValue('#lf-type')) === '데크' && await D.locator('[data-action="lf-type"][data-val="데크"].active').count() === 1);
  await D.fill('#lf-title', '홍천 A-12');
  await D.click('[data-action="lo-save"]'); await settle();
  let L1 = layoutBy(A, '홍천 A-12');
  check('4 저장: { siteW 6, siteD 8, siteType 데크, entrance bottom, logId c1, items [] , createdBy } + 바로 편집 화면', L1 && L1.siteW === 6 && L1.siteD === 8 && L1.siteType === '데크' && L1.entrance === 'bottom' && L1.logId === 'c1'
    && Array.isArray(L1.items) && L1.items.length === 0 && L1.createdBy === 'uidAlice' && await D.locator('#lo-board svg').count() === 1 && /사이트 6\.0 × 8\.0m · 데크 · 진입로 아래/.test(await D.locator('.lo-siteline').innerText()), L1);
  const lid = L1.id;
  check('4 물건이 없으면 판정 카드 "아직 놓은 물건이 없어요", 자동 배치 비활성', /아직 놓은 물건이 없어요/.test(await D.locator('#lo-verdict').innerText()) && await D.locator('[data-action="lo-auto"]').isDisabled());

  // ================= 5. 장비 놓기 =================
  await D.click('[data-action="lo-place"]'); await settle(200);
  const pickNames = await D.locator('.lpk-row:not(.is-nofp) .sr-name').allInnerTexts();
  check('5 장비 놓기 창: 크기 있는 장비만 고를 수 있음(텐트 → 타프 순)', JSON.stringify(pickNames) === JSON.stringify(['돔텐트', '리빙쉘', '렉타 타프']), pickNames);
  check('5 크기 없는 장비는 회색 + "크기 입력"', (await D.locator('.lpk-row.is-nofp').count()) === 3 && await D.locator('.lpk-row.is-nofp:has-text("원터치 텐트") [data-action="lpk-size"]').count() === 1);
  await D.click('.lpk-row.is-nofp:has-text("원터치 텐트") [data-action="lpk-size"]'); await settle(200);
  check('5 "크기 입력" → 그 장비 수정 창(종류 기본값 텐트)', (await D.inputValue('#gf-name')) === '원터치 텐트' && (await D.inputValue('#gf-fp-kind')) === 'tent');
  await D.fill('#gf-fp-w', '2.1'); await D.fill('#gf-fp-d', '2.1');
  await D.click('[data-action="gear-save"]'); await settle();
  check('5 저장하면 장비 놓기 창으로 돌아와 그 장비가 골라져 있음', server[A + 'gear/g5'].footprint.w === 2.1 && await D.locator('.lpk-item[value="g5"]:checked').count() === 1 && await D.locator('#modal-root .lpk-list').count() === 1);
  await D.click('.lpk-item[value="g5"]');
  for (const g of ['g1', 'g2', 'g3']) await D.click(`.lpk-item[value="${g}"]`);
  await D.click('[data-action="lpk-go"]'); await settle();
  L1 = layoutBy(A, '홍천 A-12');
  const items1 = L1.items;
  check('5 3개를 놓음: 크기는 사본(gearId·name·kind·w·d·guy), 위치는 사이트 안 0.1m 단위', items1.length === 3 && items1.every(it => it.gearId && it.x * 10 === Math.round(it.x * 10) && it.y * 10 === Math.round(it.y * 10))
    && items1.find(it => it.gearId === 'g1').w === 4.5 && items1.find(it => it.gearId === 'g1').guy === 0.5 && items1.find(it => it.gearId === 'g3').kind === 'tarp', items1);
  const v1 = await D.evaluate(id => layoutVerdict(state.layouts.find(l => l.id === id)).level, lid);
  check('5 하나씩 빈 곳을 찾아 놓아서 6×8m에 셋 모두 → 가능', v1 === 'ok' && await D.locator('#lo-verdict.lo-v-ok').count() === 1, v1);
  // 직접 추가 + 빠른 칩
  await D.click('[data-action="lo-place"]'); await settle(200);
  check('5 크기 있는 장비가 있으면 "직접 추가"는 접혀 있음', !(await D.locator('[data-action="lpk-quick"]').first().isVisible()));
  await D.click('.lpk-custom summary');
  await D.click('[data-action="lpk-quick"][data-i="0"]');
  check('5 빠른 선택 "차량" → 이름·4.8×1.9·기타', (await D.inputValue('#lpk-name')) === '차량' && (await D.inputValue('#lpk-w')) === '4.8' && (await D.inputValue('#lpk-d')) === '1.9' && (await D.inputValue('#lpk-kind')) === 'item');
  await D.click('[data-action="lpk-custom"]'); await settle();
  L1 = layoutBy(A, '홍천 A-12');
  const car = L1.items.find(it => it.name === '차량');
  check('5 직접 추가해서 놓기: gearId 없는 기타 물건', L1.items.length === 4 && car && !car.gearId && car.kind === 'item' && car.w === 4.8 && car.d === 1.9, car);
  check('5 놓은 물건이 골라진 상태(도구 막대)', await D.locator('.lo-bar').isVisible() && /차량/.test(await D.locator('.lo-bar').innerText()));
  // 빼기 → 되돌리기
  await D.click('.lo-bar [data-action="lo-del-item"]'); await settle();
  check('5 빼기 → 저장소에서 빠지고 되돌리기 토스트', layoutBy(A, '홍천 A-12').items.length === 3 && await D.locator('#toast [data-action="undo-delete"]').isVisible());
  await D.click('#toast [data-action="undo-delete"]'); await settle();
  check('5 되돌리기 → 같은 자리·같은 id로 다시', layoutBy(A, '홍천 A-12').items.some(it => it.id === car.id && it.x === car.x && it.y === car.y));
  await D.click(`[data-action="lo-pick"][data-item="${car.id}"]`); await settle(200);
  await D.click('.lo-bar [data-action="lo-del-item"]'); await settle();

  // ================= 6. 자동 배치 =================
  await D.evaluate(id => { const L = state.layouts.find(l => l.id === id); const it = L.items.find(x => x.gearId === 'g2'); mutateLayout('me', id, loOps.set(it.id, { x: 1.4, y: 1.3, rot: 0 })); }, lid); await settle();
  const beforeAuto = JSON.stringify(layoutBy(A, '홍천 A-12').items.map(it => [it.x, it.y, it.rot]));
  check('6 (준비) 돔텐트를 리빙쉘에 겹치게 옮기면 어려움', await D.locator('#lo-verdict.lo-v-bad').count() === 1);
  await D.click('[data-action="lo-auto"]'); await settle();
  L1 = layoutBy(A, '홍천 A-12');
  const autoV = await D.evaluate(id => { const L = state.layouts.find(l => l.id === id); const v = layoutVerdict(L); return { level: v.level, issues: v.issues.map(x => x.text), ms: state.loAutoMs }; }, lid);
  check('6 자동 배치: 6×8m에 리빙쉘·돔텐트·원터치 텐트… → 가능', autoV.level === 'ok', autoV);
  check('6 자동 배치 토스트 "자동으로 놓았어요 · 되돌리기"', /자동으로 놓았어요/.test(await toastText(D)) && await D.locator('#toast [data-action="undo-delete"]').isVisible());
  const afterAuto = JSON.stringify(L1.items.map(it => [it.x, it.y, it.rot]));
  await D.click('#toast [data-action="undo-delete"]'); await settle();
  check('6 되돌리기 → 자동 배치 전 위치', JSON.stringify(layoutBy(A, '홍천 A-12').items.map(it => [it.x, it.y, it.rot])) === beforeAuto && beforeAuto !== afterAuto);
  await D.click('[data-action="lo-auto"]'); await settle();
  // 테스트 시나리오 그대로: 리빙쉘 + 돔텐트 + 타프만
  const scen = await D.evaluate(() => {
    const mk = (id, name, kind, w, d, guy) => ({ id, name, kind, shape: 'rect', w, d, guy, x: 0, y: 0, rot: 0 });
    const run = (W, D2, items) => { const L = { siteW: W, siteD: D2, entrance: 'bottom', items }; const t0 = performance.now(); const r = loAutoArrange(L); const ms = performance.now() - t0;
      const L2 = { ...L, items: items.map(it => ({ ...it, ...r.pos[it.id] })) }; const v = layoutVerdict(L2); return { level: v.level, failed: r.failed.map(x => x.name), need: v.need, ms, texts: v.issues.map(x => x.text) }; };
    const three = [mk('a', '리빙쉘', 'tent', 4.5, 3.0, 0.5), mk('b', '돔텐트', 'tent', 2.7, 2.4, 0.5), mk('c', '타프', 'tarp', 3, 3, 0)];
    const two = [mk('a', '리빙쉘', 'tent', 4.5, 3.0, 0.5), mk('b', '돔텐트', 'tent', 2.7, 2.4, 0.5)];
    const six = [mk('a', '리빙쉘', 'tent', 4.5, 3.0, 0.5), mk('b', '돔텐트', 'tent', 2.7, 2.4, 0.5), mk('c', '타프', 'tarp', 3, 3, 0), mk('d', '테이블', 'item', 1.2, 0.8, 0), mk('e', '화로대', 'item', 0.6, 0.6, 0), mk('f', '차량', 'item', 4.8, 1.9, 0)];
    return { a: run(6, 8, three), b: run(5, 5, two), c: run(8, 10, six) };
  });
  check('6 6×8m 리빙쉘 4.5×3.0(+0.5)·돔텐트 2.7×2.4(+0.5)·타프 3×3 → 가능', scen.a.level === 'ok' && !scen.a.failed.length, scen.a);
  check('6 5×5m 같은 텐트 둘 → 어려움 + 무엇이 얼마나 부족한지', scen.b.level === 'bad' && scen.b.failed.length === 1 && scen.b.need && /부족/.test(scen.b.need.short) && /사이트가 최소 \d+\.\d × \d+\.\d+m 필요/.test(scen.b.need.min), scen.b);
  check('6 8×10m 물건 6개 자동 배치 1초 이내', scen.c.ms < 1000, scen.c.ms);
  // 화면: 5×5m 배치에서 자동 배치 → 판정 카드 안내
  await D.click('[data-action="lo-back"]'); await settle();
  await D.click('.lo-head-new, [data-action="lo-new"]'); await settle(200);
  await D.fill('#lf-title', '좁은 사이트'); await D.fill('#lf-w', '5'); await D.fill('#lf-d', '5');
  await D.click('[data-action="lo-save"]'); await settle();
  const L5 = layoutBy(A, '좁은 사이트');
  await D.click('[data-action="lo-place"]'); await settle(200);
  await D.click('.lpk-item[value="g1"]'); await D.click('.lpk-item[value="g2"]');
  await D.click('[data-action="lpk-go"]'); await settle();
  await D.click('[data-action="lo-auto"]'); await settle();
  const vtext = await D.locator('#lo-verdict').innerText();
  check('6 화면: 5×5m 자동 배치 → ✕ 어려움 + "…을 놓을 자리가 없어요 — … 부족, 사이트가 최소 …m 필요"', await D.locator('#lo-verdict.lo-v-bad').count() === 1 && /✕/.test(vtext) && /놓을 자리가 없어요/.test(vtext) && /부족/.test(vtext) && /최소/.test(vtext), vtext);

  // ================= 7. 판정 규칙 =================
  const verdicts = await D.evaluate(() => {
    const mk = (id, name, kind, w, d, guy, x, y, extra) => ({ id, name, kind, shape: 'rect', w, d, guy, x, y, rot: 0, ...(extra || {}) });
    const V = (items, W, D2, ent) => { const v = layoutVerdict({ siteW: W || 6, siteD: D2 || 8, entrance: ent || 'bottom', items }); return { level: v.level, texts: v.issues.map(x => x.text), shorts: v.issues.map(x => x.short), tag: loVerdictTag(v).text, aisle: v.aisle }; };
    return {
      ok: V([mk('a', '리빙쉘', 'tent', 4.5, 3, 0.5, 2.8, 2.0), mk('b', '돔텐트', 'tent', 2.7, 2.4, 0.5, 2.0, 5.2)]),
      overlap: V([mk('a', '돔텐트', 'tent', 2.7, 2.4, 0, 2, 2), mk('b', '리빙쉘', 'tent', 4.5, 3, 0, 3, 4.3)]),
      outside: V([mk('a', '돔텐트', 'tent', 2.7, 2.4, 0, 2, 0.9)]),
      guyOut: V([mk('a', '돔텐트', 'tent', 2.7, 2.4, 0.5, 1.65, 3)]),
      guyHit: V([mk('a', '돔텐트', 'tent', 2, 2, 0.8, 1.5, 2), mk('b', '테이블', 'item', 1.2, 0.8, 0, 3.6, 2)]),
      tarp: V([mk('a', '돔텐트', 'tent', 2.7, 2.4, 0, 2, 2), mk('b', '타프', 'tarp', 3, 3, 0, 2.5, 3), mk('c', '타프2', 'tarp', 3, 3, 0, 3, 3.5)]),
      tarpOut: V([mk('a', '타프', 'tarp', 3, 3, 0, 5.5, 3)]),
      aisle: V([mk('a', '돔텐트', 'tent', 2.7, 2.4, 0, 2, 6.4)]),
      aisleOk: V([mk('a', '돔텐트', 'tent', 2.7, 2.4, 0, 2, 6.2)]),
      aisleLeft: V([mk('a', '돔텐트', 'tent', 2.7, 2.4, 0, 1.6, 4)], 6, 8, 'left'),
      zero: V([mk('a', '이상한 물건', 'item', 0, 0, 0, 3, 3)]),
      round: V([mk('a', '원형 텐트', 'tent', 3, 3, 0, 1.6, 1.6, { shape: 'round' }), mk('b', '원형 텐트', 'tent', 3, 3, 0, 4.3, 4.3, { shape: 'round' })]),
      roundHit: V([mk('a', '원형 텐트', 'tent', 3, 3, 0, 1.6, 1.6, { shape: 'round' }), mk('b', '돔텐트', 'tent', 2, 2, 0, 3.5, 1.6)]),
      rot: V([mk('a', '리빙쉘', 'tent', 4.5, 3, 0, 1.6, 3, { rot: 90 })]),
    };
  });
  check('7 판정: 겹침·밖 없음 → ✓ 가능', verdicts.ok.level === 'ok' && verdicts.ok.tag === '✓ 가능', verdicts.ok);
  check('7 판정: 텐트끼리 겹침 → ✕ 어려움 "돔텐트와 리빙쉘이 0.4m 겹쳐요"', verdicts.overlap.level === 'bad' && verdicts.overlap.texts[0] === '돔텐트와 리빙쉘이 0.4m 겹쳐요' && /^✕ 어려움 · /.test(verdicts.overlap.tag), verdicts.overlap);
  check('7 판정: 본체가 사이트 밖 → ✕ 어려움(얼마나 "위쪽 0.3m")', verdicts.outside.level === 'bad' && /위쪽 0\.3m 밖/.test(verdicts.outside.texts[0]), verdicts.outside);
  check('7 판정: 스트링만 밖 → ⚠ 확인 필요', verdicts.guyOut.level === 'warn' && /스트링/.test(verdicts.guyOut.texts[0]) && /왼쪽 0\.2m/.test(verdicts.guyOut.texts[0]) && /^⚠ 가능 · 확인 1$/.test(verdicts.guyOut.tag), verdicts.guyOut);
  check('7 판정: 스트링이 다른 물건 본체에 걸림 → ⚠', verdicts.guyHit.level === 'warn' && /테이블 자리에 걸려요/.test(verdicts.guyHit.texts.join()), verdicts.guyHit);
  check('7 판정: 타프는 텐트·타프와 겹쳐도 가능', verdicts.tarp.level === 'ok', verdicts.tarp);
  check('7 판정: 타프 본체가 사이트 밖 → ✕', verdicts.tarpOut.level === 'bad', verdicts.tarpOut);
  check('7 판정: 진입로 쪽 통로 0.6m 미만 → ⚠, 0.6m 이상이면 가능', verdicts.aisle.level === 'warn' && /통로가 0\.4m/.test(verdicts.aisle.texts[0]) && verdicts.aisleOk.level === 'ok', [verdicts.aisle, verdicts.aisleOk]);
  check('7 판정: 진입로 왼쪽이면 왼쪽 통로를 봄', verdicts.aisleLeft.level === 'warn' && Math.abs(verdicts.aisleLeft.aisle - 0.25) < 0.06, verdicts.aisleLeft);
  check('7 판정: 크기 0 → ⚠', verdicts.zero.level === 'warn' && /크기가 0/.test(verdicts.zero.texts[0]));
  check('7 판정: 원형 물건 — 네모 칸은 겹쳐도 원끼리 안 닿으면 가능, 닿으면 어려움', verdicts.round.level === 'ok' && verdicts.roundHit.level === 'bad', [verdicts.round, verdicts.roundHit]);
  check('7 판정: 회전(rot 90)은 가로·세로를 바꿔 계산(3.0 폭 → 안)', verdicts.rot.level === 'ok', verdicts.rot);

  // ================= 8. 끌기·회전·위치·키보드 =================
  await D.click('[data-action="lo-back"]'); await settle();
  await D.click(`.lo-card[data-id="${lid}"]`); await settle();
  L1 = layoutBy(A, '홍천 A-12');
  const dome = L1.items.find(it => it.gearId === 'g2');
  const scale = await D.evaluate(() => _loView.scale);
  const box = await D.locator(`[data-lo-item="${dome.id}"] .lo-body`).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await D.mouse.move(cx, cy); await D.mouse.down();
  await D.mouse.move(cx + scale * 0.5, cy, { steps: 4 });
  check('8 끄는 동안은 저장하지 않음', layoutBy(A, '홍천 A-12').items.find(it => it.id === dome.id).x === dome.x);
  await D.mouse.move(cx + scale * 1.03, cy - scale * 0.48, { steps: 4 });
  await D.mouse.up(); await settle();
  const moved = layoutBy(A, '홍천 A-12').items.find(it => it.id === dome.id);
  check('8 끌어서 옮기기(포인터): 놓을 때 저장, 0.1m 단위로 맞춤', Math.abs(moved.x - (dome.x + 1.0)) < 0.051 && Math.abs(moved.y - (dome.y - 0.5)) < 0.051 && Math.round(moved.x * 10) === moved.x * 10 && Math.round(moved.y * 10) === moved.y * 10, [dome.x, dome.y, moved.x, moved.y]);
  check('8 끈 물건이 골라지고 도구 막대에 경계까지 거리', await D.locator('.lo-bar').isVisible() && /돔텐트/.test(await D.locator('.lo-bar').innerText()) && /(왼쪽|오른쪽) \d+\.\dm/.test(await D.locator('#lo-bar-dist').innerText())
    && await D.locator('.lo-dist').count() >= 1);
  await D.click('.lo-bar [data-action="lo-rot"]'); await settle();
  check('8 ↻ 90° 회전 → rot 90(중심 그대로)', layoutBy(A, '홍천 A-12').items.find(it => it.id === dome.id).rot === 90 && layoutBy(A, '홍천 A-12').items.find(it => it.id === dome.id).x === moved.x);
  await D.click('.lo-bar [data-action="lo-pos"]'); await settle(200);
  check('8 위치 창: 왼쪽 위 모서리 x, y', await D.locator('#lpos-x').count() === 1 && await D.locator('#lpos-y').count() === 1);
  await D.fill('#lpos-x', '0.6'); await D.fill('#lpos-y', '4.4');
  await D.click('[data-action="lo-pos-save"]'); await settle();
  const posd = layoutBy(A, '홍천 A-12').items.find(it => it.id === dome.id);
  check('8 위치 입력 → 왼쪽 0.6m 위 4.4m(rot 90이라 2.4×2.7)', Math.abs(posd.x - (0.6 + 1.2)) < 1e-6 && Math.abs(posd.y - (4.4 + 1.35)) < 1e-6, posd);
  const aria = await D.locator(`[data-lo-item="${dome.id}"]`).getAttribute('aria-label');
  check('8 물건 aria-label "돔텐트 2.4×2.7m, 왼쪽 0.6m 위 4.4m…", tabindex·role', /^돔텐트 2\.4×2\.7m, 왼쪽 0\.6m 위 4\.4m/.test(aria) && (await D.locator(`[data-lo-item="${dome.id}"]`).getAttribute('role')) === 'button' && (await D.locator(`[data-lo-item="${dome.id}"]`).getAttribute('tabindex')) === '0', aria);
  await D.locator(`[data-lo-item="${dome.id}"]`).focus();
  await D.keyboard.press('ArrowRight'); await settle(200);
  await D.keyboard.press('Shift+ArrowUp'); await settle(200);
  const kb = layoutBy(A, '홍천 A-12').items.find(it => it.id === dome.id);
  check('8 키보드 화살표 0.1m, Shift 0.5m', Math.abs(kb.x - (posd.x + 0.1)) < 1e-6 && Math.abs(kb.y - (posd.y - 0.5)) < 1e-6, kb);
  check('8 키보드로 옮긴 뒤에도 초점이 그 물건에', await D.evaluate(id => document.activeElement && document.activeElement.getAttribute('data-lo-item') === id, dome.id));
  await D.keyboard.press('r'); await settle(200);
  check('8 R 회전', layoutBy(A, '홍천 A-12').items.find(it => it.id === dome.id).rot === 180);
  await D.keyboard.press('Escape'); await settle(200);
  check('8 Esc 선택 해제', await D.locator('.lo-bar').count() === 0);
  await D.locator(`[data-lo-item="${dome.id}"]`).focus();
  await D.keyboard.press('Delete'); await settle();
  check('8 Delete 빼기(되돌리기 토스트)', !layoutBy(A, '홍천 A-12').items.some(it => it.id === dome.id) && await D.locator('#toast [data-action="undo-delete"]').isVisible());
  await D.click('#toast [data-action="undo-delete"]'); await settle();
  check('8 되돌리기 → 다시 있음', layoutBy(A, '홍천 A-12').items.some(it => it.id === dome.id));
  // 이유를 누르면 그 물건이 선택됨
  await D.evaluate(id => { const L = state.layouts.find(l => l.id === id); const it = L.items.find(x => x.name === '돔텐트'); mutateLayout('me', id, loOps.set(it.id, { x: 0.8, y: 4 })); }, lid); await settle();
  const issueBtn = D.locator('#lo-verdict [data-action="lo-issue"]').first();
  check('8 문제 있으면 판정 카드에 ✕/⚠ 아이콘 + 글', await issueBtn.count() === 1 && /[✕⚠]/.test(await issueBtn.innerText()) && /돔텐트/.test(await issueBtn.innerText()));
  const issueItem = await issueBtn.getAttribute('data-item');
  await D.click('[data-action="lo-unpick"]').catch(() => {}); await settle(150);
  await D.locator('#lo-verdict [data-action="lo-issue"]').first().click(); await settle(200);
  check('8 이유를 누르면 그 물건 선택', (await D.evaluate(() => state.layoutPick)) === issueItem && issueItem === dome.id && await D.locator('.lo-bar').isVisible());
  // 장비 크기가 바뀌면 "새로 불러오기"
  await D.evaluate(() => { const g = state.gear.find(x => x.id === 'g1'); g.footprint = { ...g.footprint, w: 4.8 }; persistGear(g); renderView(); }); await settle();
  check('8 장비 크기가 바뀌면 "장비 크기가 바뀌었어요 · 새로 불러오기"', /장비 크기가 바뀌었어요/.test(await D.locator('.lo-list').innerText()));
  await D.click('[data-action="lo-refresh"]'); await settle();
  check('8 새로 불러오기 → 사본 크기 갱신', layoutBy(A, '홍천 A-12').items.find(it => it.gearId === 'g1').w === 4.8 && !(/장비 크기가 바뀌었어요/.test(await D.locator('.lo-list').innerText())));

  // ================= 9. 목록 카드·⋯ =================
  await D.click('[data-action="lo-back"]'); await settle();
  const card = D.locator(`.lo-card[data-id="${lid}"]`);
  check('9 목록 카드: 미리보기 SVG · 제목 · "6.0 × 8.0m · 리빙쉘, …" · 판정 태그', await card.locator('svg.lo-prev').count() === 1 && /홍천 A-12/.test(await card.innerText()) && /6\.0 × 8\.0m · /.test(await card.innerText()) && await card.locator('.lo-tag').count() === 1);
  await menuClick(D, `.lo-card[data-id="${lid}"] [data-action="lo-dup"]`); await settle();
  const dup = layoutBy(A, '홍천 A-12 복사');
  check('9 ⋯ 복제', dup && dup.items.length === layoutBy(A, '홍천 A-12').items.length);
  await menuClick(D, `.lo-card[data-id="${dup.id}"] [data-action="lo-meta"]`); await settle(200);
  await D.fill('#lf-title', '복사본'); await D.fill('#lf-w', '7'); await D.click('[data-action="lf-ent"][data-val="left"]');
  await D.click('[data-action="lo-save"]'); await settle();
  const dup2 = layoutsOf(A).find(l => l.id === dup.id);
  check('9 ⋯ 이름·사이트 크기 바꾸기(물건은 그대로)', dup2.title === '복사본' && dup2.siteW === 7 && dup2.entrance === 'left' && dup2.items.length === dup.items.length, dup2);
  await menuClick(D, `.lo-card[data-id="${dup.id}"] [data-action="lo-del"]`); await settle(200);
  await D.click('[data-action="confirm-yes"]'); await settle();
  check('9 ⋯ 삭제: 확인 → 삭제 + 되돌리기', !layoutsOf(A).some(l => l.id === dup.id) && await D.locator('#toast [data-action="undo-delete"]').isVisible());
  await D.click('#toast [data-action="undo-delete"]'); await settle();
  check('9 삭제 되돌리기 → 같은 내용', layoutsOf(A).some(l => l.id === dup.id && l.title === '복사본' && l.items.length === dup.items.length));

  // ================= 10. 연결: 일정 패널 ⋯·캠핑 기록·일정 삭제 =================
  await nav(D, 'checklist'); await settle();
  await D.locator('.trip-chip:has-text("홍천 가을 캠핑")').first().click(); await settle();
  await menuClick(D, '.trip-panel [data-action="trip-layout"]'); await settle(200);
  check('10 일정 패널 ⋯ "사이트 배치"(연결 없음) → 배치 만들기 창(제목 = 일정 이름, 일정 연결, 같은 캠핑장 후기 크기)', (await D.locator('#view-title').innerText()) === '사이트 배치'
    && (await D.inputValue('#lf-title')) === '홍천 가을 캠핑' && (await D.inputValue('#lf-trip')) === 't1' && (await D.inputValue('#lf-w')) === '6.0' && (await D.inputValue('#lf-logid')) === 'c1');
  await D.click('[data-action="lo-save"]'); await settle();
  const LT = layoutBy(A, '홍천 가을 캠핑');
  check('10 저장 → tripId 연결', LT && LT.tripId === 't1');
  await nav(D, 'checklist'); await settle();
  await D.locator('.trip-chip:has-text("홍천 가을 캠핑")').first().click(); await settle();
  await menuClick(D, '.trip-panel [data-action="trip-layout"]'); await settle();
  check('10 다시 누르면 연결된 배치 편집 화면이 열림', (await D.evaluate(() => state.layoutSel)) === LT.id && await D.locator('#lo-board svg').count() === 1);
  await D.click('[data-action="lo-back"]'); await settle();
  check('10 목록 카드에 일정 태그', /홍천 가을 캠핑/.test(await D.locator(`.lo-card[data-id="${LT.id}"] .trip-tag`).innerText()));
  await nav(D, 'camping'); await settle();
  check('10 캠핑 기록 ⋯ "이 사이트로 배치 만들기"는 크기를 읽을 수 있을 때만', await D.locator('.camp-row:has-text("홍천 강변") [data-action="camp-layout"]').count() === 1 && await D.locator('.camp-row:has-text("가평 숲속") [data-action="camp-layout"]').count() === 0);
  await menuClick(D, '.camp-row:has-text("홍천 강변") [data-action="camp-layout"]'); await settle(200);
  check('10 → 배치 만들기 창을 그 기록으로 채움', (await D.locator('#view-title').innerText()) === '사이트 배치' && (await D.inputValue('#lf-title')) === '홍천 강변 캠핑장' && (await D.inputValue('#lf-w')) === '6.0' && (await D.inputValue('#lf-d')) === '8.0' && (await D.inputValue('#lf-logid')) === 'c1');
  await D.click('#modal-root [data-action="modal-close"]'); await settle();
  // 일정 삭제 → 배치의 tripId만 풀림, 되돌리면 다시
  await nav(D, 'checklist'); await settle();
  await D.locator('.trip-chip:has-text("홍천 가을 캠핑")').first().click(); await settle();
  await menuClick(D, '.trip-panel [data-action="trip-del"]'); await settle(200);
  await D.click('[data-action="confirm-yes"]'); await settle();
  check('10 일정 삭제 → 배치는 남고 tripId만 풀림', layoutsOf(A).some(l => l.id === LT.id) && !('tripId' in layoutsOf(A).find(l => l.id === LT.id)));
  await D.click('#toast [data-action="undo-delete"]'); await settle();
  check('10 되돌리면 다시 연결', layoutsOf(A).find(l => l.id === LT.id).tripId === 't1' && !!server[A + 'trips/t1']);

  // ================= 11. 그룹 =================
  const B = await phone(UB);
  await nav(D, 'gear'); await settle();
  await pickSpace(D, '캠핑팸');
  await goLayouts(D);
  check('11 그룹 공간 사이트 배치(공간 칩은 Gear와 같음)', /캠핑팸 사이트 배치/.test(await D.locator('.section-head h1').innerText()) && await D.locator('.space-chip.active:has-text("캠핑팸")').count() === 1);
  await D.click('[data-action="lo-new"]'); await settle(200);
  check('11 그룹 배치 만들기: 그룹 일정만 연결 목록에', /팸 캠핑/.test(await D.locator('#lf-trip').innerText()) && !/홍천 가을 캠핑/.test(await D.locator('#lf-trip').innerText()));
  await D.fill('#lf-title', '팸 사이트'); await D.fill('#lf-w', '10'); await D.fill('#lf-d', '8');
  await D.click('[data-action="lo-save"]'); await settle();
  const GL = layoutBy(G + '/', '팸 사이트');
  check('11 그룹 배치 저장(groups/{gid}/layouts)', GL && GL.createdBy === 'uidAlice' && GL.siteW === 10);
  await nav(B, 'gear'); await settle();
  await pickSpace(B, '캠핑팸');
  await goLayouts(B);
  check('11 A가 만든 배치가 B에게 실시간으로 보임(만든 사람 사진)', await B.locator(`.lo-card[data-id="${GL.id}"]`).count() === 1 && /앨리스/.test(await B.locator(`.lo-card[data-id="${GL.id}"] .lo-owner`).innerText()));
  // A: 그룹 장비 + 내 장비(리빙쉘) 놓기
  await D.click('[data-action="lo-place"]'); await settle(200);
  check('11 그룹 공간 장비 놓기: [그룹 장비 | 내 장비]', await D.locator('[data-action="lpk-src"]').count() === 2);
  await D.click('.lpk-item[value="gg1"]'); await D.click('.lpk-item[value="gg2"]');
  await D.click('[data-action="lpk-go"]'); await settle();
  await D.click('[data-action="lo-place"]'); await settle(200);
  await D.click('[data-action="lpk-src"][data-src="me"]'); await settle(200);
  await D.click('.lpk-item[value="g1"]');
  await D.click('[data-action="lpk-go"]'); await settle();
  const gItems = () => (layoutBy(G + '/', '팸 사이트') || {}).items || [];
  check('11 내 개인 장비를 그룹 배치에 놓음(사본)', gItems().length === 3 && gItems().some(it => it.gearId === 'g1' && it.w === 4.8 && it.name === '리빙쉘'));
  await B.click(`.lo-card[data-id="${GL.id}"]`); await settle();
  check('11 B에게도 내 장비(리빙쉘)가 보임', await B.locator('.lo-row:has-text("리빙쉘")').count() === 1 && await B.locator('[data-lo-item]').count() === 3);
  // 거의 동시에 다른 물건 옮기기
  const [ia, ib] = [gItems().find(it => it.gearId === 'gg1'), gItems().find(it => it.gearId === 'g1')];
  await Promise.all([
    D.evaluate(([gid, id, it]) => mutateLayout(gid, id, loOps.set(it, { x: 1.6, y: 1.6 })), ['grpFam', GL.id, ia.id]),
    B.evaluate(([gid, id, it]) => mutateLayout(gid, id, loOps.set(it, { x: 7.0, y: 2.0 })), ['grpFam', GL.id, ib.id]),
  ]);
  await settle(1500);
  const fa = gItems().find(it => it.id === ia.id), fb = gItems().find(it => it.id === ib.id);
  check('11 A와 B가 다른 물건을 거의 동시에 옮겨도 둘 다 반영', fa && fb && fa.x === 1.6 && fa.y === 1.6 && fb.x === 7.0 && fb.y === 2.0, [fa, fb]);
  check('11 updatedBy·updatedAt 남김', ['uidAlice', 'uidBob'].includes(layoutBy(G + '/', '팸 사이트').updatedBy) && !!layoutBy(G + '/', '팸 사이트').updatedAt);
  // 비멤버
  const C = await phone(UC);
  const denied = await C.evaluate(async () => {
    const fs = window.__FIREBASE_MODULES__.firestore;
    const out = {};
    try { await fs.setDoc(fs.doc({}, 'groups/grpFam/layouts', 'x'), { title: 'hack', items: [] }); out.write = 'ok'; } catch (e) { out.write = e.code; }
    try { await fs.getDocs(fs.collection({}, 'groups/grpFam/layouts')); out.read = 'ok'; } catch (e) { out.read = e.code; }
    return out;
  });
  check('11 비멤버는 그룹 배치 읽기·쓰기 거부', denied.write === 'permission-denied' && denied.read === 'permission-denied', denied);
  // 그룹 백업 왕복
  await D.evaluate(() => exportGroupBackup('grpFam')); await settle(500);
  const gjson = JSON.parse(await D.inputValue('#backup-text'));
  check('11 그룹 백업에 layouts 포함', Array.isArray(gjson.layouts) && gjson.layouts.some(l => l.title === '팸 사이트' && l.items.length === 3));
  await D.click('#modal-root [data-action="modal-close"]'); await settle();
  delete server[G + '/layouts/' + GL.id];
  for (const p of pages) await p.evaluate(id => window.__fsApply('groups/grpFam/layouts/' + id, null), GL.id);
  await settle();
  await D.evaluate(async j => { const r = parseGroupBackup(j); await applyGroupBackup('grpFam', r.data); }, JSON.stringify(gjson)); await settle(600);
  check('11 그룹 백업 가져오기 → 배치 복구', layoutBy(G + '/', '팸 사이트') && layoutBy(G + '/', '팸 사이트').items.length === 3);
  const oldBk = { ...gjson }; delete oldBk.layouts;
  await D.evaluate(async j => { const r = parseGroupBackup(j); await applyGroupBackup('grpFam', r.data); }, JSON.stringify(oldBk)); await settle(600);
  check('11 layouts 없는 예전 그룹 백업 → 지금 배치 그대로', !!layoutBy(G + '/', '팸 사이트'));
  // 개인 백업 왕복
  const pb = await D.evaluate(() => JSON.stringify(buildBackup()));
  const pbOld = JSON.parse(pb); delete pbOld.layouts;
  const parsedOld = await D.evaluate(t => parseBackup(t).data.layouts, JSON.stringify(pbOld));
  const parsedNew = await D.evaluate(t => parseBackup(t).data.layouts.length, pb);
  check('11 개인 백업: layouts 왕복, 예전 백업(없음)은 null → 지금 배치 유지', parsedOld === null && parsedNew === layoutsOf(A).length, [parsedOld, parsedNew]);

  // ================= 12. 390px: 하위 탭·도구 막대 =================
  const M = await phone(UA, { mobile: true });
  await nav(M, 'gear'); await settle();
  await pickSpace(M, '내 공간');
  check('12 휴대폰: Gear 화면 맨 위 하위 탭 [장비 n | 사이트 배치 n]', await M.locator('.sub-tab[data-view="layouts"]').isVisible() && /사이트 배치\s*\d+/.test(await M.locator('.sub-tab[data-view="layouts"]').innerText()) && await M.locator('.sub-tab[data-view="gear"].active').count() === 1);
  await M.click('.sub-tab[data-view="layouts"]'); await settle();
  check('12 하위 탭으로 이동(탭바 Gear 켜짐)', (await M.locator('#view-title').innerText()) === '사이트 배치' && await M.locator('#mobile-tabbar [data-nav="gear"].active').count() === 1 && await M.locator('.sub-tab[data-view="layouts"].active').count() === 1);
  await M.click(`.lo-card[data-id="${lid}"]`); await settle();
  const bw = await M.locator('#lo-board svg').boundingBox();
  check('12 390px: 배치판이 폭 안에(가로 스크롤 없음)', bw && bw.x >= 0 && bw.x + bw.width <= 390 && (await M.evaluate(() => document.documentElement.scrollWidth)) <= 390, bw);
  const first = await M.locator('.lo-row').first().getAttribute('data-item');
  await M.click(`.lo-row[data-item="${first}"]`); await settle();
  const bar = await M.locator('.lo-bar').boundingBox(), tab = await M.locator('#mobile-tabbar').boundingBox();
  check('12 도구 막대가 하단 탭바 위에 보임', bar && tab && bar.y + bar.height <= tab.y + 1 && await M.locator('.lo-bar').isVisible(), [bar, tab]);
  const rotHit = await M.evaluate(() => { const b = document.querySelector('.lo-bar [data-action="lo-rot"]'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!el && !!el.closest('[data-action="lo-rot"]'); });
  check('12 도구 막대 버튼이 실제로 눌림(elementFromPoint)', rotHit);
  const btnH = await M.locator('.lo-bar [data-action="lo-rot"]').boundingBox();
  check('12 도구 막대 버튼 높이 ≥ 40px', btnH.height >= 40, btnH);
  await M.evaluate(() => { const m = document.getElementById('main'); m.scrollTop = m.scrollHeight; }); await settle(300);
  const lastRow = await M.locator('.lo-row').last().boundingBox(), bar2 = await M.locator('.lo-bar').boundingBox();
  check('12 맨 아래로 스크롤해도 물건 목록이 막대에 가려지지 않음', lastRow.y + lastRow.height <= bar2.y + 1, [lastRow, bar2]);
  // 휴대폰 터치로 끌기
  // 끌 물건을 화면 위쪽에 오게 스크롤(아래쪽은 도구 막대가 덮음)
  await M.evaluate(id => { const m = document.getElementById('main'); const r = document.querySelector(`[data-lo-item="${id}"] .lo-body`).getBoundingClientRect(); m.scrollTop += r.top - 220; }, first); await settle(200);
  const before = layoutBy(A, '홍천 A-12').items.find(it => it.id === first);
  const tb = await M.locator(`[data-lo-item="${first}"] .lo-body`).boundingBox();
  const sc = await M.evaluate(() => _loView.scale);
  const cdp = await M.context().newCDPSession(M);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const tx = tb.x + tb.width / 2, ty = tb.y + tb.height / 2;
  await tp('touchStart', tx, ty);
  for (let i = 1; i <= 5; i++) await tp('touchMove', tx, ty + sc * 0.2 * i);
  await tp('touchEnd'); await settle();
  const after = layoutBy(A, '홍천 A-12').items.find(it => it.id === first);
  check('12 터치로 끌기(touch-action:none, 0.1m 맞춤)', Math.abs(after.y - before.y - 1.0) < 0.21 && Math.round(after.y * 10) === after.y * 10 && (await M.locator('#lo-board').evaluate(el => getComputedStyle(el).touchAction)) === 'none', [before.y, after.y]);

  // ================= 13. 그룹 삭제 → 배치도 정리 =================
  await nav(D, 'settings'); await settle();
  await D.evaluate(() => deleteGroup('grpFam')); await settle(800);
  check('13 그룹 삭제 시 groups/{gid}/layouts도 삭제', layoutsOf(G + '/').length === 0 && !server[G]);

  // ================= 14. 화면 규칙 =================
  const contrast = await D.evaluate(() => {
    const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const rgb = v => { const d = document.createElement('div'); d.style.color = v; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
    const out = {};
    for (const theme of ['light', 'dark']) {
      document.documentElement.setAttribute('data-theme', theme);
      const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
      out[theme] = { warn: cr(rgb(css('--warn-text')), rgb(css('--surface'))), good: cr(rgb(css('--good-text')), rgb(css('--surface'))), bad: cr(rgb(css('--bad')), rgb(css('--surface'))), tentText: cr(rgb(css('--text')), rgb(css('--lo-tent-fill'))), barText: cr(rgb(css('--lo-bar-fg')), rgb(css('--lo-bar-bg'))), warnIsAccent: css('--warn-text') === css('--accent') };
    }
    document.documentElement.removeAttribute('data-theme');
    return out;
  });
  check('14 밝은·어두운 모드: 판정 글자색·배치판 글자 대비 4.5:1 이상, 확인 글자색은 앰버(--accent)와 다름', ['light', 'dark'].every(t => contrast[t].warn >= 4.5 && contrast[t].good >= 4.5 && contrast[t].bad >= 4.5 && contrast[t].tentText >= 4.5 && contrast[t].barText >= 4.5 && !contrast[t].warnIsAccent), contrast);
  await nav(D, 'gear'); await settle();
  await goLayouts(D);
  const accents = await D.evaluate(() => [...document.querySelectorAll('.btn-accent')].map(b => b.dataset.action));
  await D.click(`.lo-card[data-id="${lid}"]`); await settle();
  accents.push(...await D.evaluate(() => [...document.querySelectorAll('.btn-accent')].map(b => b.dataset.action)));
  check('14 앰버 채움은 "+ 배치 만들기"·"+ 장비 놓기"에만', accents.length >= 2 && accents.every(a => ['lo-new', 'lo-place'].includes(a)), accents);
  const iconBtns = await D.evaluate(() => [...document.querySelectorAll('#main .icon-btn, #main .lo-bar .icon-btn')].filter(b => !b.getAttribute('aria-label')).length);
  check('14 아이콘 버튼 aria-label', iconBtns === 0, iconBtns);

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
