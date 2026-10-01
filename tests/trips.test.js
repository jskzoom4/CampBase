// 캠핑 일정 테스트 (가짜 Firestore/Auth):
//  개인/그룹 일정 만들기·수정·삭제(되돌리기), 템플릿 저장 → 일정 만들 때 복사, 기존 리스트 연결·빈 리스트,
//  일정 선택 시 리스트 필터, 진행률·내 담당 계산, Home "다음 캠핑" 카드(개인·그룹 중 가장 가까운 것, 일정 없음 안내),
//  후기 남기기 미리 채움 + tripRef + "작성함" 표시, 그룹 B에게 그룹 일정 실시간 표시, 예전 위젯 설정 이어받기.
// 실행: node tests/trips.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-trips-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8771;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const UC = { uid: 'uidCarol', displayName: '캐롤', email: 'carol@example.com', photoURL: '' };
const UD = { uid: 'uidDan', displayName: '댄', email: 'dan@example.com', photoURL: '' };

const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const md = off => { const d = new Date(); d.setDate(d.getDate() + off); return { m: d.getMonth() + 1, d: d.getDate() }; };

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const server = {};
  const pages = [];
  async function phone(user, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1300, height: 950 } });
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
    return page;
  }
  const put = async (p, d) => { if (d === null) delete server[p]; else server[p] = d; for (const pg of pages) await pg.evaluate(([p2, d2]) => window.__fsApply(p2, d2), [p, d]).catch(() => {}); };
  const settle = () => sleep(350);
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const toastText = p => p.locator('#toast').innerText();
  const confirmYes = async p => { await p.waitForSelector('[data-action="confirm-yes"]', { timeout: 3000 }); await p.click('[data-action="confirm-yes"]'); };
  const pickSpace = async (p, label) => { await p.locator(`.space-chip:has-text("${label}")`).first().click(); await settle(); };
  const keys = re => Object.keys(server).filter(k => re.test(k));
  const docsUnder = prefix => keys(new RegExp('^' + prefix.replace(/[/]/g, '\\/') + '[^/]+$')).map(k => ({ key: k, id: k.split('/').pop(), ...server[k] }));
  const A_ = 'users/' + UA.uid + '/';
  async function fillTrip(p, { title, start, end, campsite, region, method, template, link, uncheck }) {
    await p.waitForSelector('#tf-title', { timeout: 3000 });
    if (title !== undefined) await p.fill('#tf-title', title);
    if (start !== undefined) await p.fill('#tf-start', start);
    if (end !== undefined) await p.fill('#tf-end', end);
    if (campsite !== undefined) await p.fill('#tf-campsite', campsite);
    if (region !== undefined) await p.fill('#tf-region', region);
    for (const u of uncheck || []) await p.uncheck(`.tf-member[value="${u}"]`);
    if (method) await p.click(`[data-action="trip-start-pick"][data-val="${method}"]`);
    if (template) await p.selectOption('#tf-template', { label: template });
    if (link) await p.selectOption('#tf-link', { label: link });
    await p.click('[data-action="trip-save"]');
    await settle();
  }

  // ---- 준비: A의 개인 리스트 2개, D의 예전 위젯 설정(기준 지역 위젯 꺼짐), 그룹(A 그룹장, B·C 멤버) ----
  server[A_ + 'checklists/cl1'] = { title: '기본 준비물', items: [
    { id: 'i1', label: '텐트', status: 'packed', group: '텐트/침구' },
    { id: 'i2', label: '침낭', status: 'skip', group: '텐트/침구' },
    { id: 'i3', label: '랜턴', status: 'pending', group: '조명' },
  ] };
  server[A_ + 'checklists/cl2'] = { title: '요리 준비물', items: [{ id: 'k1', label: '버너', status: 'pending', group: '조리' }] };
  server['users/' + UD.uid + '/settings/app'] = { gearCategories: ['기타'], homeWidgets: { location: false, camping: true, gear: true, checklist: true } };
  const GID = 'grpFam', G = 'groups/' + GID;
  server[G] = { name: '캠핑팸', ownerUid: UA.uid, memberUids: [UA.uid, UB.uid, UC.uid], createdAt: '2026-01-01T00:00:00Z', gearCategories: ['기타'],
    members: { [UA.uid]: { name: '앨리스', photoURL: '', role: 'owner' }, [UB.uid]: { name: '밥', photoURL: '', role: 'member' }, [UC.uid]: { name: '캐롤', photoURL: '', role: 'member' } } };
  server[G + '/checklists/gcl'] = { title: '그룹 기본', addedBy: UA.uid, items: [
    { id: 'g1', label: '타프', status: 'pending', group: '쉘터', addedBy: UA.uid },
    { id: 'g2', label: '아이스박스', status: 'pending', group: '조리', addedBy: UB.uid },
  ] };

  const A = await phone(UA);

  // ================= 1. 일정 없음 → Home 안내 =================
  await nav(A, 'home');
  await A.waitForSelector('.next-trip-card', { timeout: 3000 }).catch(() => {});
  check('일정이 없으면 Home에 "다음 캠핑 일정을 만들어보세요"', /다음 캠핑 일정을 만들어보세요/.test(await A.locator('.next-trip-card').innerText().catch(() => '')));
  await A.click('.next-trip-card');
  await A.waitForSelector('#tf-title', { timeout: 3000 }).catch(() => {});
  check('안내를 누르면 Checklist 탭 + 일정 만들기 창', (await A.locator('#tf-title').count()) === 1 && /Checklist/.test(await A.locator('#view-title').innerText()));
  await A.click('[data-action="modal-close"]');

  // ================= 2. 템플릿으로 저장 =================
  await A.click('.checklist-group:has-text("기본 준비물") [data-action="cl-save-template"]');
  await settle();
  const tpls = docsUnder(A_ + 'checklistTemplates/');
  check('템플릿으로 저장: { title, items:[{label, group}] } (체크 상태·id 없음)', tpls.length === 1 && tpls[0].title === '기본 준비물'
    && same(tpls[0].items, [{ label: '텐트', group: '텐트/침구' }, { label: '침낭', group: '텐트/침구' }, { label: '랜턴', group: '조명' }]), tpls);

  // ================= 3. 개인 일정 만들기(템플릿 복사) =================
  check('Checklist 탭 위쪽에 일정 줄(전체 + 일정 만들기)', (await A.locator('.trip-bar [data-action="trip-pick"][data-trip="all"]').count()) === 1 && (await A.locator('.trip-bar [data-action="trip-new"]').count()) === 1);
  await A.click('[data-action="trip-new"]');
  check('템플릿이 있으면 시작 방법 기본값은 "템플릿에서 복사"', (await A.locator('#tf-start-method .seg-btn.active[data-val="template"]').count()) === 1);
  await fillTrip(A, { title: '홍천 캠핑', start: ymd(3), end: ymd(4), campsite: '홍천 강변 캠핑장', region: '홍천', template: '기본 준비물 (3개)' });
  const pTrips = docsUnder(A_ + 'trips/');
  const t1 = pTrips[0] || {};
  check('개인 일정 저장: users/{uid}/trips/{id} = { title, startDate, endDate, campsiteName, region, createdBy, createdAt, updatedBy }',
    pTrips.length === 1 && t1.title === '홍천 캠핑' && t1.startDate === ymd(3) && t1.endDate === ymd(4) && t1.campsiteName === '홍천 강변 캠핑장' && t1.region === '홍천'
    && t1.createdBy === UA.uid && t1.updatedBy === UA.uid && !!t1.createdAt && !('memberUids' in t1), t1);
  const copied = docsUnder(A_ + 'checklists/').filter(l => l.tripId === t1.id);
  check('템플릿 복사: 새 리스트에 tripId 연결 + 항목은 모두 미정 + 새 id', copied.length === 1 && copied[0].title === '기본 준비물' && copied[0].id !== 'cl1'
    && copied[0].items.length === 3 && copied[0].items.every(i => i.status === 'pending' && !['i1', 'i2', 'i3'].includes(i.id)), copied);
  check('원래 리스트는 그대로(연결 없음, 체크 상태 유지)', !server[A_ + 'checklists/cl1'].tripId && server[A_ + 'checklists/cl1'].items[0].status === 'packed');
  check('만든 일정이 선택됨 → 연결된 리스트만 보임', (await A.locator('.trip-chip.active:has-text("홍천 캠핑")').count()) === 1
    && (await A.locator('.checklist-group').count()) === 1 && (await A.locator('.checklist-group:has-text("요리 준비물")').count()) === 0);
  const card = await A.locator('.trip-card').innerText();
  const d3 = md(3), d4 = md(4);
  const dateText = d3.m === d4.m ? `${d3.m}월 ${d3.d}일~${d4.d}일` : `${d3.m}월 ${d3.d}일~${d4.m}월 ${d4.d}일`;
  check('일정 카드: 이름·날짜·D-3·캠핑장·지역·준비 0/3', /홍천 캠핑/.test(card) && card.includes(dateText) && /D-3/.test(card) && /홍천 강변 캠핑장/.test(card) && /준비 0\/3/.test(card), card);
  await A.click('.trip-card ~ .checklist-group .check-row:has-text("텐트") [data-val="packed"]');
  await A.click('.trip-card ~ .checklist-group .check-row:has-text("침낭") [data-val="skip"]');
  await settle();
  check('진행률 = 연결된 리스트 항목 중 결정된 것/전체(가져감·안 가져감 모두 결정)', /준비 2\/3/.test(await A.locator('.trip-card').innerText()));
  check('개인 일정 카드에는 "내 담당" 없음', !/내 담당/.test(await A.locator('.trip-card').innerText()));
  await A.click('[data-action="trip-pick"][data-trip="all"]');
  check('"전체"를 고르면 모든 리스트 + 연결된 리스트에 일정 표시', (await A.locator('.checklist-group').count()) === 3 && (await A.locator('.checklist-group .trip-tag:has-text("홍천 캠핑")').count()) === 1);

  // 새 리스트는 선택한 일정에 연결
  await A.click('.trip-chip:has-text("홍천 캠핑")');
  await A.click('[data-action="cl-new-list"]');
  await A.fill('#ncl-title', '추가 장보기');
  await A.click('[data-action="cl-new-list-save"]');
  await settle();
  check('일정을 보는 중에 만든 새 리스트는 그 일정에 연결', docsUnder(A_ + 'checklists/').some(l => l.title === '추가 장보기' && l.tripId === t1.id));

  // ================= 4. 수정 =================
  await A.click('.trip-card [data-action="trip-edit"]');
  check('수정 창에는 체크리스트 시작 방법이 없음', (await A.locator('#tf-start-method').count()) === 0);
  await fillTrip(A, { title: '홍천 가을 캠핑' });
  const t1b = server[A_ + 'trips/' + t1.id];
  check('일정 수정: 이름 변경, 만든 사람·만든 시각 유지', t1b.title === '홍천 가을 캠핑' && t1b.createdAt === t1.createdAt && t1b.createdBy === UA.uid && t1b.startDate === ymd(3));
  await A.click('[data-action="trip-edit"]');
  await fillTrip(A, { start: ymd(5), end: ymd(4) });
  check('종료일이 시작일보다 빠르면 저장 안 함', /종료일/.test(await toastText(A)) && server[A_ + 'trips/' + t1.id].startDate === ymd(3));
  await A.click('[data-action="modal-close"]');

  // ================= 5. 기존 리스트 연결 / 빈 리스트 =================
  await A.click('[data-action="trip-new"]');
  await fillTrip(A, { title: '가평 당일', start: ymd(10), end: '', method: 'link', link: '요리 준비물' });
  const t2 = docsUnder(A_ + 'trips/').find(t => t.title === '가평 당일');
  check('종료일을 비우면 시작일과 같게', t2 && t2.endDate === ymd(10));
  check('기존 리스트 연결: 그 리스트에 tripId', t2 && server[A_ + 'checklists/cl2'].tripId === t2.id && server[A_ + 'checklists/cl2'].items.length === 1);
  await A.click('[data-action="trip-new"]');
  await fillTrip(A, { title: '빈 일정', start: ymd(20), method: 'empty' });
  const t3 = docsUnder(A_ + 'trips/').find(t => t.title === '빈 일정');
  check('빈 리스트: "일정 이름 준비물" 리스트를 만들어 연결', t3 && docsUnder(A_ + 'checklists/').some(l => l.title === '빈 일정 준비물' && l.tripId === t3.id && l.items.length === 0));

  // ================= 6. 삭제(연결만 해제) → 되돌리기 =================
  await A.click('.trip-chip:has-text("가평 당일")');
  const t2before = JSON.parse(JSON.stringify(server[A_ + 'trips/' + t2.id]));
  await A.click('.trip-card [data-action="trip-del"]');
  check('일정 삭제는 확인 모달', /일정을 삭제할까요[\s\S]*연결만 풀어요/.test(await A.locator('#modal-root').innerText()));
  await confirmYes(A);
  await settle();
  check('일정 삭제: 일정 문서 삭제 + 연결된 리스트는 남고 연결만 해제', !server[A_ + 'trips/' + t2.id] && !!server[A_ + 'checklists/cl2'] && !server[A_ + 'checklists/cl2'].tripId);
  check('삭제 후 "전체" 보기로', (await A.locator('[data-action="trip-pick"][data-trip="all"].active').count()) === 1);
  await A.click('#toast [data-action="undo-delete"]');
  await settle();
  check('되돌리기: 일정이 같은 내용으로 + 리스트 연결도 복구', same(server[A_ + 'trips/' + t2.id], t2before) && server[A_ + 'checklists/cl2'].tripId === t2.id);

  // ================= 7. 템플릿 관리(일정 만들기 창 안) =================
  await A.click('[data-action="trip-new"]');
  await A.fill('#tf-title', '입력 중');
  const tplId = tpls[0].id;
  await A.fill(`.tpl-name-input[data-id="${tplId}"]`, '기본 세트');
  await A.click(`[data-action="tpl-rename"][data-id="${tplId}"]`);
  await settle();
  check('템플릿 이름 변경(입력 중인 일정 이름은 그대로)', server[A_ + 'checklistTemplates/' + tplId].title === '기본 세트' && (await A.inputValue('#tf-title')) === '입력 중'
    && /기본 세트/.test(await A.locator('#tf-template').innerText()));
  await A.click(`[data-action="tpl-del"][data-id="${tplId}"]`);
  await settle();
  check('템플릿 삭제 + 되돌리기 토스트', !server[A_ + 'checklistTemplates/' + tplId] && (await A.locator('#toast [data-action="undo-delete"]').count()) === 1);
  await A.click('#toast [data-action="undo-delete"]');
  await settle();
  check('템플릿 삭제 되돌리기(창 안 목록도 다시 보임)', server[A_ + 'checklistTemplates/' + tplId] && server[A_ + 'checklistTemplates/' + tplId].title === '기본 세트'
    && (await A.locator(`.tpl-name-input[data-id="${tplId}"]`).count()) === 1);
  await A.click('[data-action="modal-close"]');

  // ================= 8. 그룹 일정 =================
  const B = await phone(UB, { mobile: true });
  const C = await phone(UC);
  await nav(B, 'checklist');
  await pickSpace(B, '캠핑팸');
  await nav(A, 'checklist');
  await pickSpace(A, '캠핑팸');
  check('공간을 바꾸면 일정 선택은 "전체"로', (await A.locator('[data-action="trip-pick"][data-trip="all"].active').count()) === 1);
  check('그룹 공간에는 개인 일정이 안 보임', (await A.locator('.trip-chip:has-text("홍천")').count()) === 0);
  await A.click('.checklist-group:has-text("그룹 기본") [data-action="cl-save-template"]');
  await settle();
  const gtpl = docsUnder(G + '/checklistTemplates/');
  check('그룹 템플릿은 groups/{gid}/checklistTemplates에 저장', gtpl.length === 1 && gtpl[0].title === '그룹 기본' && docsUnder(A_ + 'checklistTemplates/').length === 1);
  await A.click('[data-action="trip-new"]');
  check('그룹 일정: 참가 멤버 기본은 전원 선택', (await A.locator('.tf-member:checked').count()) === 3);
  await fillTrip(A, { title: '팸 캠핑', start: ymd(1), end: ymd(2), campsite: '가평 숲속', region: '가평', template: '그룹 기본 (2개)', uncheck: [UC.uid] });
  const gt = docsUnder(G + '/trips/')[0] || {};
  check('그룹 일정 저장: groups/{gid}/trips + memberUids(고른 사람)', gt.title === '팸 캠핑' && same([...gt.memberUids].sort(), [UA.uid, UB.uid].sort()) && gt.createdBy === UA.uid, gt);
  const gl = docsUnder(G + '/checklists/').find(l => l.tripId === gt.id) || {};
  check('그룹 템플릿 복사: 그룹 리스트 + 항목 addedBy', gl.title === '그룹 기본' && gl.items.length === 2 && gl.items.every(i => i.addedBy === UA.uid && i.status === 'pending') && gl.addedBy === UA.uid, gl);
  await B.waitForSelector('.trip-chip:has-text("팸 캠핑")', { timeout: 3000 }).catch(() => {});
  check('그룹 B에게도 그룹 일정이 실시간으로 보임', (await B.locator('.trip-chip:has-text("팸 캠핑")').count()) === 1);
  // 담당자: A에게 타프, B에게 아이스박스
  await A.click('.trip-card ~ .checklist-group .check-row:has-text("타프") [data-action="cl-assign"]');
  await A.click(`[data-action="cl-assign-set"][data-uid="${UA.uid}"]`);
  await A.click('.trip-card ~ .checklist-group .check-row:has-text("아이스박스") [data-action="cl-assign"]');
  await A.click(`[data-action="cl-assign-set"][data-uid="${UB.uid}"]`);
  await settle();
  const gcard = await A.locator('.trip-card').innerText();
  check('그룹 일정 카드: 참가 2명 + 준비 0/2 + 내 담당 1개 남음', /2명 참가/.test(gcard) && /준비 0\/2/.test(gcard) && /내 담당 1개 남음/.test(gcard), gcard);
  await B.click('.trip-chip:has-text("팸 캠핑")');
  await B.click('.check-row:has-text("아이스박스") [data-val="packed"]');
  await settle();
  check('B가 체크하면 A의 진행률도 실시간 갱신(1/2)', /준비 1\/2/.test(await A.locator('.trip-card').innerText()));
  check('B 화면: 내 담당 0개 남음', /내 담당 0개 남음/.test(await B.locator('.trip-card').innerText()));

  // ================= 9. Home "다음 캠핑" 카드 =================
  await nav(A, 'home');
  await settle();
  const home = await A.locator('.next-trip-card').innerText();
  const g1 = md(1), g2 = md(2);
  const gDate = g1.m === g2.m ? `${g1.m}월 ${g1.d}일~${g2.d}일` : `${g1.m}월 ${g1.d}일~${g2.m}월 ${g2.d}일`;
  check('Home 다음 캠핑: 개인(D-3)보다 가까운 그룹 일정(D-1) 표시 + 그룹 이름', /팸 캠핑/.test(home) && /D-1/.test(home) && home.includes(gDate) && /가평 숲속/.test(home) && /캠핑팸/.test(home), home);
  check('Home 다음 캠핑: 준비 1/2 · 내 담당 1개 남음', /준비 1\/2/.test(home) && /내 담당 1개 남음/.test(home), home);
  await A.click('.next-trip-card');
  await settle();
  check('카드를 누르면 그 공간의 Checklist 탭에서 그 일정이 선택된 채로', /Checklist/.test(await A.locator('#view-title').innerText())
    && (await A.locator('.space-chip.active:has-text("캠핑팸")').count()) === 1 && (await A.locator('.trip-chip.active:has-text("팸 캠핑")').count()) === 1);
  await nav(C, 'home');
  await settle();
  check('참가하지 않은 그룹 일정은 C의 다음 캠핑에 안 나옴', !/팸 캠핑/.test(await C.locator('#main').innerText()));
  check('Home의 다른 통계는 개인 데이터만(그룹 리스트 항목 미포함)', await (async () => { await nav(A, 'home'); return /준비물 체크 현황/.test(await A.locator('#main').innerText()); })());

  // ================= 10. 끝난 일정 → 후기 남기기 =================
  await put(A_ + 'trips/past1', { title: '춘천 캠핑', startDate: ymd(-4), endDate: ymd(-2), campsiteName: '춘천 호수 캠핑장', region: '춘천', createdBy: UA.uid, createdAt: 'x', updatedBy: UA.uid });
  await put(G + '/trips/gpast', { title: '팸 지난 캠핑', startDate: ymd(-12), endDate: ymd(-10), campsiteName: '양평 캠핑장', region: '양평', memberUids: [UA.uid, UB.uid], createdBy: UB.uid, createdAt: 'x', updatedBy: UB.uid });
  await nav(A, 'home');
  await settle();
  check('Home: 끝난 지 7일 이내 + 내 후기 없는 일정 → "후기를 남겨보세요"', /'춘천 캠핑' 후기를 남겨보세요/.test(await A.locator('#main').innerText()) && !/팸 지난 캠핑/.test(await A.locator('#main').innerText()));
  await nav(A, 'checklist');
  await pickSpace(A, '내 공간');
  check('지난 일정은 "지난 일정 ▾"로 접힘', (await A.locator('.trip-chip:has-text("춘천 캠핑")').count()) === 0 && (await A.locator('[data-action="trip-past-toggle"]').count()) === 1);
  await A.click('[data-action="trip-past-toggle"]');
  await A.click('.trip-chip:has-text("춘천 캠핑")');
  check('끝난 일정 카드: "끝남" + "후기 남기기"', /끝남/.test(await A.locator('.trip-card').innerText()) && (await A.locator('.trip-card [data-action="trip-review"]').count()) === 1);
  await A.click('.trip-card [data-action="trip-review"]');
  await A.waitForSelector('#cf-name', { timeout: 3000 });
  check('후기 폼 미리 채움: 캠핑장 이름·지역·날짜(시작일)', (await A.inputValue('#cf-name')) === '춘천 호수 캠핑장' && (await A.inputValue('#cf-region')) === '춘천' && (await A.inputValue('#cf-date')) === ymd(-4));
  await A.fill('#cf-rating', '5');
  await A.click('[data-action="camp-save"]');
  await settle();
  const review = docsUnder(A_ + 'campingLogs/').find(c => c.name === '춘천 호수 캠핑장');
  check('저장하면 내 캠핑 기록 + tripRef { space:"me", tripId }', review && same(review.tripRef, { space: 'me', tripId: 'past1' }) && review.rating === 5, review);
  check('일정 카드에 "내 후기 작성함"', (await A.locator('.trip-card .trip-reviewed').count()) === 1 && (await A.locator('.trip-card [data-action="trip-review"]').count()) === 0);
  await nav(A, 'home');
  check('후기를 쓰면 Home 안내가 사라짐', !/춘천 캠핑' 후기를/.test(await A.locator('#main').innerText()));
  // 기록을 수정해도 tripRef 유지
  await nav(A, 'camping');
  await A.click('.list-row:has-text("춘천 호수 캠핑장") [data-action="camp-edit"]');
  await A.fill('#cf-notes', '호수 뷰 최고');
  await A.click('[data-action="camp-save"]');
  await settle();
  check('후기를 수정해도 tripRef 유지', same(server[review.key].tripRef, { space: 'me', tripId: 'past1' }) && server[review.key].notes === '호수 뷰 최고');
  // 그룹 일정 후기는 tripRef.space = gid
  await nav(A, 'checklist');
  await pickSpace(A, '캠핑팸');
  await A.click('[data-action="trip-past-toggle"]');
  await A.click('.trip-chip:has-text("팸 지난 캠핑")');
  await A.click('.trip-card [data-action="trip-review"]');
  await A.waitForSelector('#cf-name', { timeout: 3000 });
  await A.click('[data-action="camp-save"]');
  await settle();
  const gReview = docsUnder(A_ + 'campingLogs/').find(c => c.name === '양평 캠핑장');
  check('그룹 일정 후기도 내 개인 기록에 저장 + tripRef.space = 그룹 id', gReview && same(gReview.tripRef, { space: GID, tripId: 'gpast' }) && docsUnder(G + '/campingLogs/').length === 0);
  check('그룹 일정 카드에 "내 후기 작성함"(내 화면 기준)', (await A.locator('.trip-card .trip-reviewed').count()) === 1);
  await B.click('[data-action="trip-past-toggle"]').catch(() => {});
  await B.click('.trip-chip:has-text("팸 지난 캠핑")');
  check('B 화면에서는 B의 후기가 없으니 "후기 남기기"', (await B.locator('.trip-card [data-action="trip-review"]').count()) === 1);

  // ================= 11. 그룹 일정 삭제(그룹 공간) 되돌리기 + 규칙 =================
  await A.click('.trip-chip:has-text("팸 캠핑")');
  const gtBefore = JSON.parse(JSON.stringify(server[G + '/trips/' + gt.id]));
  await A.click('.trip-card [data-action="trip-del"]');
  await confirmYes(A);
  await settle();
  await B.waitForSelector('.trip-chip:has-text("팸 캠핑"):not(:has-text("지난"))', { state: 'detached', timeout: 3000 }).catch(() => {});
  check('그룹 일정 삭제: B 화면에서도 사라지고 리스트 연결만 해제', !server[G + '/trips/' + gt.id] && !!server[gl.key] && !server[gl.key].tripId);
  await A.click('#toast [data-action="undo-delete"]');
  await settle();
  check('그룹 일정 되돌리기: memberUids·createdBy까지 그대로 + 연결 복구', same(server[G + '/trips/' + gt.id], gtBefore) && server[gl.key].tripId === gt.id);
  const odd = await B.evaluate(async g => { const m = window.__FIREBASE_MODULES__.firestore; try { await m.setDoc(m.doc({}, 'groups/' + g + '/secretStuff/x'), { v: 1 }); return 'ok'; } catch (e) { return e.code; } }, GID);
  check('(가짜 규칙) 허용 목록에 없는 그룹 하위 컬렉션은 거부', odd === 'permission-denied', odd);

  // ================= 12. 예전 위젯 설정 이어받기 + 백업 =================
  const D = await phone(UD);
  await nav(D, 'home');
  await settle();
  check('예전 "기준 지역 위젯" 꺼짐 → "다음 캠핑 카드"도 꺼짐', (await D.locator('.next-trip-card').count()) === 0);
  await nav(D, 'settings');
  const sw = D.locator('.list-row:has-text("다음 캠핑 카드") input[data-action="toggle-widget"]');
  check('Settings 위젯 이름이 "다음 캠핑 카드"', (await sw.count()) === 1 && !(await sw.isChecked()) && !/기준 지역 위젯/.test(await D.locator('#main').innerText()));
  await D.locator('.list-row:has-text("다음 캠핑 카드") label.switch').click();
  await settle();
  check('다시 켜면 nextTrip=true로 저장(예전 location 키는 정리)', server['users/' + UD.uid + '/settings/app'].homeWidgets.nextTrip === true && !('location' in server['users/' + UD.uid + '/settings/app'].homeWidgets));
  await nav(A, 'settings');
  await A.click('[data-action="backup-export"]');
  const exp = JSON.parse(await A.inputValue('#backup-text'));
  check('개인 백업에 일정·템플릿 포함', exp.trips.length === 4 && exp.checklistTemplates.length === 1, { trips: exp.trips.length, tpl: exp.checklistTemplates.length });
  await A.click('[data-action="modal-close"]');

  // ================= 13. 그룹 삭제 시 일정·템플릿도 삭제 =================
  await A.click('.group-row:has-text("캠핑팸") [data-action="group-delete"]');
  await confirmYes(A);
  await A.waitForSelector('[data-action="confirm-yes"]', { timeout: 2000 }).catch(() => {});
  await confirmYes(A);
  await settle(); await settle();
  check('그룹 삭제: trips·checklistTemplates까지 모두 삭제', keys(new RegExp('^' + G)).length === 0, keys(new RegExp('^' + G)));
  await nav(A, 'home');
  await settle();
  check('그룹이 없어지면 Home 다음 캠핑은 개인 일정(홍천 가을 캠핑)', /홍천 가을 캠핑/.test(await A.locator('.next-trip-card').innerText()) && /D-3/.test(await A.locator('.next-trip-card').innerText()));

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
