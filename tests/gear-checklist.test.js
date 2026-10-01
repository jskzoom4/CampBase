// 장비 ↔ 준비물 연결 테스트 (가짜 Firestore/Auth):
//  1) 그룹 체크리스트 담당자 추천 — 항목 이름과 비슷한 그룹 장비의 주인(일치·대소문자/공백 무시·불일치·주인 없음·나간 주인)
//  2) Gear → "체크리스트에 추가" — 개인/그룹, 일정별로 묶인 리스트 선택, 소분류=장비 카테고리, 중복 건너뛰기, 주인 자동 담당
// 실행: node tests/gear-checklist.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-g2c-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8772;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };

const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

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
  const settle = () => sleep(350);
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const toastText = p => p.locator('#toast').innerText();
  const pickSpace = async (p, label) => { await p.locator(`.space-chip:has-text("${label}")`).first().click(); await settle(); };
  const A_ = 'users/' + UA.uid + '/';
  const GID = 'grpFam', G = 'groups/' + GID;

  // ---- 준비 ----
  server[A_ + 'gear/pg1'] = { name: '스텔스 5 텐트', brand: 'Snow Peak', category: '텐트', price: 0, weight: 0, date: '' };
  server[A_ + 'gear/pg2'] = { name: '헬리녹스 체어', brand: 'Helinox', category: '체어/테이블', price: 0, weight: 0, date: '' };
  server[A_ + 'gear/pg3'] = { name: '버너', brand: 'Kovea', category: '조리용품', price: 0, weight: 0, date: '' };
  server[A_ + 'checklists/pcl'] = { title: '기본 준비물', items: [{ id: 'x1', label: ' 버 너 ', status: 'packed', group: '조리' }] };
  server[A_ + 'trips/t1'] = { title: '홍천 캠핑', startDate: ymd(5), endDate: ymd(6), campsiteName: '', region: '', createdBy: UA.uid, createdAt: 'x', updatedBy: UA.uid };
  server[A_ + 'checklists/tcl'] = { title: '홍천 준비물', tripId: 't1', items: [] };
  server[G] = { name: '캠핑팸', ownerUid: UA.uid, memberUids: [UA.uid, UB.uid, 'uidCarol'], createdAt: 'x', gearCategories: ['텐트', '타프', '체어/테이블', '조명', '기타'],
    members: { [UA.uid]: { name: '앨리스', photoURL: '', role: 'owner' }, [UB.uid]: { name: '밥', photoURL: '', role: 'member' }, uidCarol: { name: '캐롤', photoURL: '', role: 'member' } } };
  server[G + '/gear/gg1'] = { name: '스텔스 5 텐트', brand: 'Snow Peak', category: '텐트', ownerUid: UB.uid, addedBy: UB.uid };
  server[G + '/gear/gg2'] = { name: 'Helinox Chair One', brand: 'Helinox', category: '체어/테이블', ownerUid: 'uidCarol', addedBy: 'uidCarol' };
  server[G + '/gear/gg3'] = { name: '렉타 타프', brand: 'DOD', category: '타프', addedBy: UA.uid };
  server[G + '/gear/gg4'] = { name: '랜턴', brand: '기타', category: '조명', ownerUid: 'uidGone', addedBy: 'uidGone' };
  server[G + '/checklists/gcl'] = { title: '그룹 준비물', items: [
    { id: 'a1', label: '텐트', status: 'pending', group: '쉘터' },
    { id: 'a2', label: 'helinox  chair', status: 'pending', group: '의자' },
    { id: 'a3', label: '의자', status: 'pending', group: '의자' },
    { id: 'a4', label: '타프', status: 'pending', group: '쉘터' },
    { id: 'a5', label: '랜턴', status: 'pending', group: '조명' },
  ] };
  server[G + '/checklists/gcl2'] = { title: '짐 싸기', items: [] };

  const A = await phone(UA);
  const B = await phone(UB, { mobile: true });

  // ================= 1. 담당자 추천 =================
  await nav(A, 'checklist');
  await pickSpace(A, '캠핑팸');
  const openAssign = async label => { await A.click(`.check-row:has(.label:text-is("${label}")) [data-action="cl-assign"]`); await A.waitForSelector('#assign-list', { timeout: 3000 }); };
  await openAssign('텐트');
  const sug1 = await A.locator('#assign-suggest').innerText().catch(() => '');
  check('추천: "텐트" ⊂ "스텔스 5 텐트" → 주인 밥을 맨 위에 "추천 · 밥 장비 있음 (스텔스 5 텐트)"', /추천/.test(sug1) && /밥 장비 있음/.test(sug1) && /스텔스 5 텐트/.test(sug1) && (await A.locator('#assign-suggest .suggest-pick').count()) === 1, sug1);
  check('추천은 멤버 목록보다 위', await A.evaluate(() => { const s = document.getElementById('assign-suggest'), l = document.getElementById('assign-list'); return !!(s && l && (s.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)); }));
  await A.click('#assign-suggest .suggest-pick');
  await settle();
  check('추천을 누르면 한 번에 담당자 지정', server[G + '/checklists/gcl'].items[0].assigneeUid === UB.uid);
  await openAssign('helinox  chair');
  const sug2 = await A.locator('#assign-suggest').innerText().catch(() => '');
  check('추천: 공백·대소문자 무시("helinox  chair" ⊂ "Helinox Chair One") → 캐롤', /캐롤 장비 있음/.test(sug2) && /Helinox Chair One/.test(sug2), sug2);
  await A.click('[data-action="modal-close"]');
  await openAssign('의자');
  check('불일치("의자")면 추천 없음(지금처럼)', (await A.locator('#assign-suggest').count()) === 0 && (await A.locator('#assign-list .member-pick').count()) === 3);
  await A.click('[data-action="modal-close"]');
  await openAssign('타프');
  check('주인 없는 장비만 비슷하면 추천 없음', (await A.locator('#assign-suggest').count()) === 0);
  await A.click('[data-action="modal-close"]');
  await openAssign('랜턴');
  check('주인이 그룹을 나간 장비는 추천하지 않음', (await A.locator('#assign-suggest').count()) === 0);
  await A.click('[data-action="modal-close"]');

  // ================= 2. 장비 → 체크리스트 (개인) =================
  await nav(A, 'gear');
  await pickSpace(A, '내 공간');
  await A.click('[data-action="gear-to-checklist"]');
  await A.waitForSelector('#g2c-list', { timeout: 3000 });
  const groupsLabels = await A.locator('#g2c-list optgroup').evaluateAll(els => els.map(e => e.label + ':' + Array.from(e.querySelectorAll('option')).map(o => o.textContent).join('/')));
  check('리스트는 일정별로 묶어서 보여줌(일정 → 일정 없음)', groupsLabels.length === 2 && /^홍천 캠핑/.test(groupsLabels[0]) && /홍천 준비물/.test(groupsLabels[0]) && /^일정 없음:기본 준비물/.test(groupsLabels[1]), groupsLabels);
  await A.selectOption('#g2c-list', 'pcl');
  await A.click('[data-action="g2c-all"]');
  await A.click('[data-action="g2c-go"]');
  await settle();
  const pItems = server[A_ + 'checklists/pcl'].items;
  check('개인: 장비 이름 = 항목, 카테고리 = 소분류, 미정 상태', pItems.length === 3 && pItems.some(i => i.label === '스텔스 5 텐트' && i.group === '텐트' && i.status === 'pending') && pItems.some(i => i.label === '헬리녹스 체어' && i.group === '체어/테이블'), pItems);
  check('개인: 같은 이름(공백 무시 " 버 너 ")은 건너뜀, 기존 항목은 그대로', pItems.filter(i => /버\s*너/.test(i.label)).length === 1 && pItems[0].id === 'x1' && pItems[0].status === 'packed');
  check('개인: "2개 추가, 1개는 이미 있음" 토스트', /2개 추가, 1개는 이미 있음/.test(await toastText(A)), await toastText(A));
  check('개인 공간 항목에는 담당자·addedBy 없음', pItems.every(i => !i.assigneeUid && !i.addedBy));
  await A.click('[data-action="gear-to-checklist"]');
  await A.selectOption('#g2c-list', 'tcl');
  await A.check('.g2c-gear[value="pg3"]');
  await A.click('[data-action="g2c-go"]');
  await settle();
  check('일정에 연결된 리스트에도 추가', server[A_ + 'checklists/tcl'].items.length === 1 && server[A_ + 'checklists/tcl'].items[0].label === '버너' && server[A_ + 'checklists/tcl'].tripId === 't1');
  await A.click('[data-action="gear-to-checklist"]');
  await A.click('[data-action="g2c-go"]');
  check('장비를 안 고르면 안내', /장비를 골라주세요/.test(await toastText(A)));
  await A.click('[data-action="modal-close"]');

  // ================= 3. 장비 → 체크리스트 (그룹, 주인 자동 담당) =================
  await pickSpace(A, '캠핑팸');
  await A.click('[data-action="gear-to-checklist"]');
  await A.waitForSelector('#g2c-list', { timeout: 3000 });
  check('그룹 공간에서는 그룹 리스트만', (await A.locator('#g2c-list option').allInnerTexts()).sort().join(',') === '그룹 준비물,짐 싸기');
  await A.selectOption('#g2c-list', 'gcl2');
  await A.click('[data-action="g2c-all"]');
  await A.click('[data-action="g2c-go"]');
  await settle();
  const gItems = server[G + '/checklists/gcl2'].items;
  const by = n => gItems.find(i => i.label === n) || {};
  check('그룹: 4개 추가 + 소분류 = 장비 카테고리', gItems.length === 4 && by('렉타 타프').group === '타프' && by('랜턴').group === '조명', gItems);
  check('그룹: 주인 있는 장비는 그 사람이 담당자(밥·캐롤)', by('스텔스 5 텐트').assigneeUid === UB.uid && by('Helinox Chair One').assigneeUid === 'uidCarol');
  check('그룹: 주인 없는 장비·나간 주인의 장비는 담당자 없음', !by('렉타 타프').assigneeUid && !by('랜턴').assigneeUid);
  check('그룹: 추가한 사람(addedBy)·마지막 수정(updatedBy) 기록', gItems.every(i => i.addedBy === UA.uid) && server[G + '/checklists/gcl2'].updatedBy === UA.uid);
  await nav(B, 'checklist');
  await pickSpace(B, '캠핑팸');
  await B.waitForSelector('.checklist-group:has-text("짐 싸기") .check-row:has-text("스텔스 5 텐트")', { timeout: 3000 }).catch(() => {});
  check('B에게도 실시간으로 보이고 담당자 칩이 밥', (await B.locator('.checklist-group:has-text("짐 싸기") .check-row:has-text("스텔스 5 텐트") .assignee-chip.set:has-text("밥")').count()) === 1);
  await A.click('[data-action="gear-to-checklist"]');
  await A.selectOption('#g2c-list', 'gcl2');
  await A.click('[data-action="g2c-all"]');
  await A.click('[data-action="g2c-go"]');
  await settle();
  check('다시 넣으면 모두 건너뜀: "0개 추가, 4개는 이미 있음"', /0개 추가, 4개는 이미 있음/.test(await toastText(A)) && server[G + '/checklists/gcl2'].items.length === 4, await toastText(A));
  check('개인 공간 장비·리스트는 그대로', server[A_ + 'checklists/pcl'].items.length === 3);

  // 담당자 추천은 개인 공간에선 없음(담당자 칩 자체가 없음)
  await nav(A, 'checklist');
  await pickSpace(A, '내 공간');
  check('개인 공간에는 담당자 칩·추천 없음', (await A.locator('[data-action="cl-assign"]').count()) === 0);

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
