// 그룹 기능 테스트 (가짜 Firestore/Auth — 그룹 규칙도 흉내 냄).
// A가 그룹을 만들고 초대 코드 발급 → B가 코드로 참여 → 그룹 체크리스트·장비를 함께 고침,
// 개인 공간 분리, 그룹 2개 전환, 그룹으로 보내기(복사), 만료 코드 거부, 내보내기/나가기/이름 변경/삭제.
// 실행: node tests/groups.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-groups-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const UC = { uid: 'uidCarol', displayName: '캐롤', email: 'carol@example.com', photoURL: '' };

const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '8769', '-d', SITE], { stdio: 'ignore' });
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
    await page.goto('http://127.0.0.1:8769/');
    await page.waitForSelector('#login-btn:not([disabled])', { timeout: 6000 });
    await page.click('[data-action="login-google"]');
    await page.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
    return page;
  }
  // 테스트가 서버에 직접 넣는 데이터도 모든 기기에 전달
  const serverPut = async (p, d) => { server[p] = d; for (const pg of pages) await pg.evaluate(([p2, d2]) => window.__fsApply(p2, d2), [p, d]).catch(() => {}); };
  // 모든 기기에 반영될 때까지 대기
  const settle = () => sleep(350);
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const toastText = p => p.locator('#toast').innerText();
  const confirmYes = async p => { await p.waitForSelector('[data-action="confirm-yes"]', { timeout: 3000 }); await p.click('[data-action="confirm-yes"]'); };
  const groupIdByName = name => (Object.entries(server).find(([k, v]) => /^groups\/[^/]+$/.test(k) && v.name === name) || [''])[0].split('/')[1];
  const pickSpace = async (p, label) => { await p.locator(`.space-chip:has-text("${label}")`).first().click(); await settle(); };
  const groupRow = (p, name) => p.locator(`.group-row:has(.name:text-is("${name}")), .group-row:has-text("${name}")`).first();
  async function createGroup(p, name) {
    await nav(p, 'settings');
    await p.click('[data-action="group-new"]');
    await p.fill('#grp-name', name);
    await p.click('[data-action="group-new-save"]');
    await settle();
  }
  async function makeInvite(p, name) {
    await nav(p, 'settings');
    await groupRow(p, name).locator('[data-action="group-invite"]').click();
    await p.waitForSelector('#invite-code', { timeout: 3000 });
    const code = (await p.locator('#invite-code').innerText()).trim();
    return code;
  }
  async function joinWith(p, code) {
    await nav(p, 'settings');
    await p.click('[data-action="group-join"]');
    await p.fill('#join-code', code);
    await p.click('[data-action="group-join-check"]');
  }

  // ================= 1. 그룹 만들기 =================
  const A = await phone(UA);
  await nav(A, 'checklist');
  check('그룹이 없으면 공간 칩 없음', (await A.locator('.space-chip').count()) === 0);
  await nav(A, 'settings');
  await sleep(300);
  check('예전 공유 데이터가 없으면 "기존 공유 데이터 가져오기" 버튼 숨김', (await A.locator('[data-action="legacy-import"]').count()) === 0);
  check('Settings에 "내 그룹" + 만들기/코드로 참여', /내 그룹/.test(await A.locator('#main').innerText()) && (await A.locator('[data-action="group-new"]').count()) === 1 && (await A.locator('[data-action="group-join"]').count()) === 1);
  await createGroup(A, '캠핑팸');
  const gid = groupIdByName('캠핑팸');
  const g0 = server['groups/' + gid];
  check('그룹 만들기: 만든 사람이 그룹장이자 유일한 멤버', g0 && g0.ownerUid === UA.uid && JSON.stringify(g0.memberUids) === JSON.stringify([UA.uid]) && g0.members[UA.uid].role === 'owner' && g0.members[UA.uid].name === '앨리스' && !!g0.createdAt, g0);
  check('Settings 목록에 그룹장으로 표시', /그룹장/.test(await groupRow(A, '캠핑팸').innerText()));
  check('그룹장 행에는 이름 변경·삭제가 있고 나가기는 없음', (await groupRow(A, '캠핑팸').locator('[data-action="group-rename"]').count()) === 1 && (await groupRow(A, '캠핑팸').locator('[data-action="group-delete"]').count()) === 1 && (await groupRow(A, '캠핑팸').locator('[data-action="group-leave"]').count()) === 0);

  // 공간 칩은 Checklist·Gear에만
  const chipsIn = async tab => { await nav(A, tab); await sleep(100); return A.locator('.space-chip').count(); };
  const chipCounts = {};
  for (const t of ['home', 'camping', 'gear', 'checklist', 'cooking', 'settings']) chipCounts[t] = await chipsIn(t);
  check('공간 칩은 Checklist·Gear 탭에만 보임', chipCounts.gear === 2 && chipCounts.checklist === 2 && chipCounts.home === 0 && chipCounts.camping === 0 && chipCounts.cooking === 0 && chipCounts.settings === 0, chipCounts);

  // ================= 2. 초대 코드 → B 참여 =================
  const code = await makeInvite(A, '캠핑팸');
  const inv = server['groupInvites/' + code];
  const days = inv ? (inv.expiresAt - Date.now()) / 86400000 : 0;
  check('초대 코드: 6자리, 헷갈리는 글자(0/O/1/I) 없음', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('초대 코드 저장: groupInvites/{code} = {gid, groupName, createdBy, expiresAt(7일)}', inv && inv.gid === gid && inv.groupName === '캠핑팸' && inv.createdBy === UA.uid && days > 6.9 && days < 7.1, inv);
  await A.click('[data-action="invite-copy"]');
  await sleep(200);
  check('코드 복사 버튼 동작(토스트)', /복사/.test(await toastText(A)), await toastText(A));
  await A.click('[data-action="modal-close"]');

  const B = await phone(UB, { mobile: true });
  await joinWith(B, code.toLowerCase());   // 소문자로 입력해도 됨
  await B.waitForSelector('[data-action="confirm-yes"]', { timeout: 3000 }).catch(() => {});
  check('코드로 참여: 그룹 이름 확인(confirmModal)', /'캠핑팸' 그룹에 참여할까요/.test(await B.locator('#modal-root').innerText()));
  await confirmYes(B);
  await settle();
  const g1 = server['groups/' + gid];
  check('참여 후 memberUids·members에 B 추가(역할 member)', g1.memberUids.includes(UB.uid) && g1.members[UB.uid].role === 'member' && g1.members[UB.uid].name === '밥' && g1.joinCode === code, g1);
  check('B의 Settings에 캠핑팸(멤버) 표시', /멤버/.test(await groupRow(B, '캠핑팸').innerText()));
  check('멤버 행에는 나가기만(이름 변경·삭제 없음)', (await groupRow(B, '캠핑팸').locator('[data-action="group-leave"]').count()) === 1 && (await groupRow(B, '캠핑팸').locator('[data-action="group-rename"], [data-action="group-delete"]').count()) === 0);
  await menuClick(A, groupRow(A, '캠핑팸').locator('[data-action="group-members"]'));
  const membersText = await A.locator('#members-list').innerText();
  check('멤버 목록 보기(앨리스·밥)', /앨리스/.test(membersText) && /밥/.test(membersText) && /그룹장/.test(membersText), membersText);
  await A.click('[data-action="modal-close"]');

  // ================= 3. 그룹 체크리스트 함께 쓰기 =================
  await nav(A, 'checklist');
  await pickSpace(A, '캠핑팸');
  const note = await A.locator('.space-note').innerText().catch(e => 'ERR ' + e.message);
  check('그룹 공간 안내 표시', /캠핑팸[\s\S]*그룹 공간/.test(note), note);
  await A.click('[data-action="cl-new-list"]');
  await A.fill('#ncl-title', '그룹 준비물');
  await A.click('[data-action="cl-new-list-save"]');
  await A.click('.checklist-group:has-text("그룹 준비물") [data-action="cl-add-item"]');
  await A.fill('#cli-label', '버너'); await A.fill('#cli-group', '조리');
  await A.click('[data-action="cl-add-item-save"]');
  await settle();
  const gl = Object.entries(server).find(([k]) => k.startsWith(`groups/${gid}/checklists/`));
  check('그룹 체크리스트는 groups/{gid}/checklists에 저장 + addedBy/updatedBy', gl && gl[1].title === '그룹 준비물' && gl[1].addedBy === UA.uid && gl[1].updatedBy === UA.uid && gl[1].items[0].addedBy === UA.uid, gl && gl[1]);
  check('그룹 체크리스트는 A의 개인 공간에 저장되지 않음', !Object.keys(server).some(k => k.startsWith(`users/${UA.uid}/checklists/`)));

  await nav(B, 'checklist');
  await pickSpace(B, '캠핑팸');
  await B.waitForSelector('.check-row:has-text("버너")', { timeout: 3000 }).catch(() => {});
  check('A가 추가한 그룹 항목이 B 화면에 반영', (await B.locator('.checklist-group:has-text("그룹 준비물") .check-row:has-text("버너")').count()) === 1);
  await B.click('.check-row:has-text("버너") [data-action="cl-item-status"][data-val="packed"]');
  await A.waitForSelector('.check-row:has-text("버너") .cl-status-btn.packed.active', { timeout: 3000 }).catch(() => {});
  check('B가 체크하면 A 화면에 반영', (await A.locator('.check-row:has-text("버너") .cl-status-btn.packed.active').count()) === 1);
  check('B가 고치면 updatedBy=B, addedBy는 A 그대로', server[gl[0]].updatedBy === UB.uid && server[gl[0]].addedBy === UA.uid, { addedBy: server[gl[0]].addedBy, updatedBy: server[gl[0]].updatedBy });

  // 개인 공간 분리
  await pickSpace(A, '내 공간');
  check('A 내 공간에는 그룹 리스트가 안 보임', (await A.locator('.checklist-group:has-text("그룹 준비물")').count()) === 0);
  await A.click('[data-action="cl-new-list"]');
  await A.fill('#ncl-title', 'A개인리스트');
  await A.click('[data-action="cl-new-list-save"]');
  await A.click('.checklist-group:has-text("A개인리스트") [data-action="cl-add-item"]');
  await A.fill('#cli-label', '베개');
  await A.click('[data-action="cl-add-item-save"]');
  await settle();
  const aPersonal = Object.entries(server).find(([k, v]) => k.startsWith(`users/${UA.uid}/checklists/`) && v.title === 'A개인리스트');
  check('A 개인 리스트는 addedBy 없이 개인 공간에 저장', aPersonal && !('addedBy' in aPersonal[1]) && !('updatedBy' in aPersonal[1]), aPersonal && aPersonal[1]);
  check('B의 그룹 공간에는 A 개인 리스트가 안 보임', (await B.locator('.checklist-group:has-text("A개인리스트")').count()) === 0);
  await pickSpace(B, '내 공간');
  check('B의 내 공간에는 그룹·A 리스트 모두 안 보임', (await B.locator('.checklist-group').count()) === 0);

  // 선택한 공간은 기기에 기억
  await pickSpace(B, '캠핑팸');
  await B.reload();
  await B.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
  await nav(B, 'checklist');
  await B.waitForSelector('.space-chip.active:has-text("캠핑팸")', { timeout: 3000 }).catch(() => {});
  check('새로고침해도 선택한 공간(캠핑팸) 유지', (await B.locator('.space-chip.active:has-text("캠핑팸")').count()) === 1 && (await B.locator('.checklist-group:has-text("그룹 준비물")').count()) === 1);
  check('공간 기억은 기기(localStorage)에', (await B.evaluate(u => localStorage.getItem('campbase.space.' + u), UB.uid)) === gid);

  // Home은 항상 개인 데이터
  await pickSpace(A, '캠핑팸');
  await nav(A, 'home');
  const aHomeCl = await A.evaluate(() => Array.from(document.querySelectorAll('.legend-row[data-tab="checklist"]')).map(r => r.innerText.replace(/\s+/g, ' ').trim()));
  check('Home 대시보드는 개인 데이터만(개인 베개 미완료 1, 그룹 버너 완료는 집계 안 됨)', JSON.stringify(aHomeCl) === JSON.stringify(['완료 0', '미완료 1']), aHomeCl);
  await A.locator('[data-action="home-cat-nav"][data-tab="checklist"]').first().click();
  await sleep(150);
  check('Home에서 체크리스트로 이동하면 내 공간으로', (await A.locator('.space-chip.active:has-text("내 공간")').count()) === 1 && (await A.locator('.checklist-group:has-text("A개인리스트")').count()) === 1);

  // ================= 4. 그룹 장비 + 카테고리 =================
  await nav(A, 'gear');
  await pickSpace(A, '캠핑팸');
  check('그룹 장비 화면 제목', /캠핑팸 장비/.test(await A.locator('#main h1').first().innerText()));
  await A.click('[data-action="gear-cat-manage"]');
  await A.fill('#cat-new-name', '그룹카테고리');
  await A.click('[data-action="gear-cat-add"]');
  await A.click('[data-action="modal-close"]');
  await settle();
  check('그룹 장비 카테고리는 groups/{gid}.gearCategories에 저장', (server['groups/' + gid].gearCategories || []).includes('그룹카테고리'), server['groups/' + gid].gearCategories);
  check('그룹 카테고리가 개인 설정에 섞이지 않음', !((server[`users/${UA.uid}/settings/app`] || {}).gearCategories || []).includes('그룹카테고리'));
  await A.click('[data-action="gear-new"]');
  await A.fill('#gf-name', '공용 타프');
  await A.selectOption('#gf-category', '그룹카테고리');
  await A.click('[data-action="gear-save"]');
  await settle();
  await nav(B, 'gear');
  await B.waitForSelector('.list-row:has-text("공용 타프")', { timeout: 3000 }).catch(() => {});
  check('그룹 장비가 B에게 보임 + 추가한 사람 표시', /앨리스 추가/.test(await B.locator('.list-row:has-text("공용 타프")').innerText().catch(() => '')));

  // ================= 4-1. 담당자(체크리스트) · 장비 주인 =================
  const glKey = gl[0];
  await nav(A, 'checklist');
  await pickSpace(A, '캠핑팸');
  await A.click('.checklist-group:has-text("그룹 준비물") [data-action="cl-add-item"]');
  await A.fill('#cli-label', '코펠'); await A.fill('#cli-group', '조리');
  await A.click('[data-action="cl-add-item-save"]');
  await settle();
  check('담당자 없는 기존 항목도 그대로 보임(담당 버튼만 표시)', (await A.locator('.check-row:has-text("버너") .assignee-chip:not(.set)').count()) === 1);
  await A.click('.check-row:has-text("버너") [data-action="cl-assign"]');
  const pickText = await A.locator('#assign-list').innerText();
  check('담당자 고르기: 그룹 멤버 목록', /앨리스/.test(pickText) && /밥/.test(pickText), pickText);
  await A.click(`#assign-list [data-uid="${UB.uid}"]`);
  await settle();
  const burner = () => (server[glKey].items || []).find(i => i.label === '버너');
  check('담당자 저장: assigneeUid(uid만)', burner().assigneeUid === UB.uid && !('assigneeName' in burner()), burner());
  check('A 화면: 버너 옆에 담당자(밥) 표시', /밥/.test(await A.locator('.check-row:has-text("버너") .assignee-chip.set').innerText().catch(() => '')));
  await nav(B, 'checklist');
  await B.waitForSelector('.check-row:has-text("버너") .assignee-chip.set', { timeout: 3000 }).catch(() => {});
  check('B 화면에도 담당자 반영', /밥/.test(await B.locator('.check-row:has-text("버너") .assignee-chip.set').innerText().catch(() => '')));
  await B.click('[data-action="cl-filter"][data-filter="mine"]');
  const bMine = await B.evaluate(() => Array.from(document.querySelectorAll('.check-row .label')).map(e => e.textContent.trim()));
  check('"내 담당" 필터: 내가 담당인 항목만', JSON.stringify(bMine) === JSON.stringify(['버너']), bMine);
  await A.click('[data-action="cl-filter"][data-filter="mine"]');
  check('"내 담당" 필터: 담당이 없으면 빈 안내', (await A.locator('.check-row').count()) === 0 && /이 조건에 맞는 항목이 없어요/.test(await A.locator('#main').innerText()));
  await A.click('[data-action="cl-filter"][data-filter="all"]');
  await A.click('.check-row:has-text("버너") [data-action="cl-assign"]');
  await A.click('[data-action="cl-assign-set"][data-uid=""]');
  await settle();
  check('담당 해제: assigneeUid 삭제', !('assigneeUid' in burner()), burner());
  await B.click('[data-action="cl-filter"][data-filter="all"]');
  await pickSpace(A, '내 공간');
  check('개인 공간: 담당 버튼·"내 담당" 필터 없음', (await A.locator('.assignee-chip').count()) === 0 && (await A.locator('[data-action="cl-filter"][data-filter="mine"]').count()) === 0);

  // 장비 주인
  await nav(A, 'gear');
  await A.click('[data-action="gear-new"]');
  check('개인 공간 장비 폼에는 주인 선택 없음', (await A.locator('#gf-owner').count()) === 0);
  await A.click('[data-action="modal-close"]');
  check('개인 공간에는 주인 필터 없음', (await A.locator('[data-action="gear-owner-filter"]').count()) === 0);
  await pickSpace(A, '캠핑팸');
  const tarpKey = () => Object.keys(server).find(k => k.startsWith(`groups/${gid}/gear/`) && server[k].name === '공용 타프');
  check('주인 없는 기존 장비도 그대로 보임', (await A.locator('.list-row:has-text("공용 타프") .owner-tag').count()) === 0 && !('ownerUid' in server[tarpKey()]));
  await A.click('.list-row:has-text("공용 타프") [data-action="gear-edit"]');
  await A.selectOption('#gf-owner', UB.uid);
  await A.click('[data-action="gear-save"]');
  await settle();
  check('장비 주인 저장: ownerUid(uid만)', server[tarpKey()].ownerUid === UB.uid, server[tarpKey()]);
  check('수정해도 처음 추가한 사람(addedBy)은 유지', server[tarpKey()].addedBy === UA.uid && server[tarpKey()].updatedBy === UA.uid);
  check('장비 목록에 주인(밥) 표시', /밥/.test(await A.locator('.list-row:has-text("공용 타프") .owner-tag').innerText().catch(() => '')));
  await A.click('[data-action="gear-new"]');
  await A.fill('#gf-name', '앨리스 의자');
  await A.selectOption('#gf-owner', UA.uid);
  await A.click('[data-action="gear-save"]');
  await A.click('[data-action="gear-new"]');
  await A.fill('#gf-name', '공용 아이스박스');
  await A.click('[data-action="gear-save"]');
  await settle();
  const names = async p => (await p.evaluate(() => Array.from(document.querySelectorAll('.list-row .name')).map(e => e.childNodes[0].textContent.trim()))).sort();
  await A.click(`[data-action="gear-owner-filter"][data-owner="${UB.uid}"]`);
  check('주인별 거르기: 밥', JSON.stringify(await names(A)) === JSON.stringify(['공용 타프']), await names(A));
  await A.click(`[data-action="gear-owner-filter"][data-owner="${UA.uid}"]`);
  check('주인별 거르기: 앨리스', JSON.stringify(await names(A)) === JSON.stringify(['앨리스 의자']), await names(A));
  await A.click('[data-action="gear-owner-filter"][data-owner="none"]');
  check('주인별 거르기: 공용(주인 없음)', JSON.stringify(await names(A)) === JSON.stringify(['공용 아이스박스']), await names(A));
  await A.click('[data-action="gear-owner-filter"][data-owner="all"]');
  check('주인 필터 해제하면 전체', (await names(A)).length === 3);
  await nav(B, 'gear');
  await B.waitForSelector('.list-row:has-text("공용 타프") .owner-tag', { timeout: 3000 }).catch(() => {});
  check('B 화면에도 장비 주인 표시', /밥/.test(await B.locator('.list-row:has-text("공용 타프") .owner-tag').innerText().catch(() => '')));
  await B.click('.list-row:has-text("공용 타프") [data-action="gear-edit"]');
  check('수정 폼에 현재 주인이 선택돼 있음', (await B.inputValue('#gf-owner')) === UB.uid);
  await B.selectOption('#gf-owner', '');
  await B.click('[data-action="gear-save"]');
  await settle();
  check('주인 해제(공용) + B가 고치면 updatedBy=B, addedBy는 A', !('ownerUid' in server[tarpKey()]) && server[tarpKey()].updatedBy === UB.uid && server[tarpKey()].addedBy === UA.uid, server[tarpKey()]);

  // ================= 5. 그룹 2개 전환 =================
  await createGroup(A, '회사캠핑');
  const gid2 = groupIdByName('회사캠핑');
  await nav(A, 'gear');
  check('그룹이 2개면 칩 3개(내 공간 + 2)', (await A.locator('.space-chip').count()) === 3);
  await pickSpace(A, '회사캠핑');
  check('회사캠핑 공간에는 캠핑팸 장비가 안 보임', (await A.locator('.list-row:has-text("공용 타프")').count()) === 0 && /회사캠핑 장비/.test(await A.locator('#main h1').first().innerText()));
  await pickSpace(A, '캠핑팸');
  check('다시 캠핑팸으로 전환하면 장비가 보임', (await A.locator('.list-row:has-text("공용 타프")').count()) === 1);

  // ================= 6. 그룹으로 보내기(복사) =================
  await pickSpace(A, '내 공간');
  // 개인 카테고리 '해먹' + 장비 2개
  await A.click('[data-action="gear-cat-manage"]');
  await A.fill('#cat-new-name', '해먹');
  await A.click('[data-action="gear-cat-add"]');
  await A.click('[data-action="modal-close"]');
  for (const [nm, cat] of [['A 해먹', '해먹'], ['A 랜턴', '조명']]) {
    await A.click('[data-action="gear-new"]');
    await A.fill('#gf-name', nm);
    await A.selectOption('#gf-category', cat);
    await A.click('[data-action="gear-save"]');
  }
  await settle();
  await A.click('[data-action="gear-send"]');
  await A.selectOption('#send-group', gid);
  await A.click('[data-action="gear-send-all"]');
  await A.click('[data-action="gear-send-go"]');
  await settle();
  const groupGear = Object.entries(server).filter(([k]) => k.startsWith(`groups/${gid}/gear/`)).map(([, v]) => v);
  check('장비 여러 개를 그룹으로 복사(addedBy=A)', ['A 해먹', 'A 랜턴'].every(n => groupGear.some(g => g.name === n && g.addedBy === UA.uid)), groupGear.map(g => g.name));
  check('복사해도 개인 공간 장비는 그대로', Object.entries(server).filter(([k]) => k.startsWith(`users/${UA.uid}/gear/`)).length === 2);
  const gc = server['groups/' + gid].gearCategories;
  check('그룹에 없던 카테고리(해먹)는 그룹에 추가(기타 앞에)', gc.includes('해먹') && gc.indexOf('해먹') < gc.indexOf('기타') && gc.filter(c => c === '해먹').length === 1, gc);

  await nav(A, 'checklist');
  await menuClick(A, '.checklist-group:has-text("A개인리스트") [data-action="cl-send"]');
  await A.selectOption('#send-group', gid);
  await A.click('[data-action="cl-send-go"]');
  await settle();
  const sent = Object.entries(server).find(([k, v]) => k.startsWith(`groups/${gid}/checklists/`) && v.title === 'A개인리스트');
  check('체크리스트(리스트 단위)를 그룹으로 복사', sent && sent[1].items.length === 1 && sent[1].items[0].label === '베개' && sent[1].addedBy === UA.uid, sent && sent[1]);
  check('복사해도 개인 리스트는 그대로', !!server[aPersonal[0]]);
  await B.locator('[data-nav="checklist"]:visible').first().click();
  await B.waitForSelector('.checklist-group:has-text("A개인리스트")', { timeout: 3000 }).catch(() => {});
  check('보낸 리스트가 B의 그룹 공간에 보임', (await B.locator('.checklist-group:has-text("A개인리스트")').count()) === 1);
  await nav(A, 'checklist');
  await pickSpace(A, '캠핑팸');
  check('그룹 공간에서는 "그룹으로 보내기" 버튼 없음', (await A.locator('[data-action="cl-send"]').count()) === 0);

  // ================= 7. 잘못된·만료된 코드 =================
  const C = await phone(UC);
  await serverPut('groupInvites/XPRD23', { gid, groupName: '캠핑팸', createdBy: UA.uid, expiresAt: Date.now() - 60000, createdAt: 'x' });
  await joinWith(C, 'XPRD23');
  await sleep(300);
  check('만료된 코드는 거부', /만료/.test(await toastText(C)) && (await C.locator('[data-action="confirm-yes"]').count()) === 0, await toastText(C));
  await C.fill('#join-code', 'ZZZZ22');
  await C.click('[data-action="group-join-check"]');
  await sleep(300);
  check('없는 코드는 거부', /없는 코드/.test(await toastText(C)), await toastText(C));
  await C.fill('#join-code', 'AB0O1I');
  await C.click('[data-action="group-join-check"]');
  await sleep(200);
  check('형식이 틀린 코드(0/O/1/I)는 거부', /다시 확인/.test(await toastText(C)), await toastText(C));
  const cDirect = await C.evaluate(async ([g, code]) => {
    const m = window.__FIREBASE_MODULES__.firestore;
    try { await m.updateDoc(m.doc({}, 'groups/' + g), { memberUids: m.arrayUnion('uidCarol'), 'members.uidCarol': { name: 'x', role: 'member' }, joinCode: code }); return 'ok'; } catch (e) { return e.code; }
  }, [gid, 'XPRD23']);
  check('(가짜 규칙) 만료 코드로 직접 참여해도 거부', cDirect === 'permission-denied', cDirect);
  const cRead = await C.evaluate(async g => { const m = window.__FIREBASE_MODULES__.firestore; try { await m.getDocs(m.collection({}, 'groups/' + g + '/checklists')); return 'ok'; } catch (e) { return e.code; } }, gid);
  check('(가짜 규칙) 비멤버는 그룹 데이터 읽기 거부', cRead === 'permission-denied', cRead);
  await C.click('[data-action="modal-close"]');

  // ================= 8. 내보내기(그룹장) =================
  await joinWith(C, code);
  await confirmYes(C);
  await settle();
  await nav(C, 'gear');
  await pickSpace(C, '캠핑팸');
  check('C 참여 후 그룹 장비 보임', (await C.locator('.list-row:has-text("공용 타프")').count()) === 1);
  await nav(A, 'settings');
  await menuClick(A, groupRow(A, '캠핑팸').locator('[data-action="group-members"]'));
  await A.click('.member-row:has-text("캐롤") [data-action="group-kick"]');
  check('내보내기 전 확인(confirmModal)', /캐롤.*내보낼까요/.test(await A.locator('#modal-root').innerText()));
  await confirmYes(A);
  await settle(); await settle();
  check('내보내면 memberUids·members에서 제거', !server['groups/' + gid].memberUids.includes(UC.uid) && !(UC.uid in server['groups/' + gid].members));
  await C.waitForSelector('.space-chip', { state: 'detached', timeout: 3000 }).catch(() => {});
  check('내보내진 C: 내 공간으로 돌아오고 그룹 장비가 안 보임', (await C.locator('.list-row:has-text("공용 타프")').count()) === 0 && (await C.locator('.space-chip').count()) === 0);
  check('내보내진 C에게 안내 토스트', /내 공간으로 돌아왔어요/.test(await toastText(C)), await toastText(C));

  // ================= 9. 이름 변경 / 나가기 =================
  await nav(A, 'settings');
  await menuClick(A, groupRow(A, '캠핑팸').locator('[data-action="group-rename"]'));
  await A.fill('#grp-rename', '캠핑팸🔥');
  await A.click('[data-action="group-rename-save"]');
  await settle();
  check('그룹장이 이름 변경', server['groups/' + gid].name === '캠핑팸🔥');
  await nav(B, 'gear');
  await B.waitForSelector('.space-chip:has-text("캠핑팸🔥")', { timeout: 3000 }).catch(() => {});
  check('바뀐 이름이 B의 칩에 반영', (await B.locator('.space-chip:has-text("캠핑팸🔥")').count()) === 1);
  const bRename = await B.evaluate(async g => { const m = window.__FIREBASE_MODULES__.firestore; try { await m.updateDoc(m.doc({}, 'groups/' + g), { name: '밥이 바꿈' }); return 'ok'; } catch (e) { return e.code; } }, gid);
  check('(가짜 규칙) 멤버는 이름 변경 거부', bRename === 'permission-denied', bRename);

  await nav(B, 'settings');
  await menuClick(B, groupRow(B, '캠핑팸🔥').locator('[data-action="group-leave"]'));
  check('나가기 전 확인(confirmModal)', /나갈까요/.test(await B.locator('#modal-root').innerText()));
  await confirmYes(B);
  await settle(); await settle();
  check('나가면 memberUids에서 빠짐', !server['groups/' + gid].memberUids.includes(UB.uid));
  check('나가도 B가 고친 항목은 그룹에 남음', !!server[gl[0]] && !!tarpKey() && server[tarpKey()].updatedBy === UB.uid);
  check('B의 그룹 목록이 비고 칩이 사라짐', /아직 그룹이 없어요/.test(await B.locator('#groups-card').innerText()));
  check('B가 나간 뒤에는 그룹 공간을 기억하지 않음', await (async () => { await nav(B, 'checklist'); return (await B.locator('.space-chip').count()) === 0 && (await B.locator('.checklist-group:has-text("그룹 준비물")').count()) === 0; })());

  // ================= 10. 그룹 삭제(그룹장, 두 번 확인) =================
  const inv2 = await makeInvite(A, '캠핑팸🔥');
  await A.click('[data-action="modal-close"]');
  await nav(A, 'gear');
  await pickSpace(A, '캠핑팸🔥');
  await nav(A, 'settings');
  await menuClick(A, groupRow(A, '캠핑팸🔥').locator('[data-action="group-delete"]'));
  check('삭제 1차 확인', /삭제할까요/.test(await A.locator('#modal-root').innerText()));
  await A.click('[data-action="confirm-yes"]');
  await A.waitForSelector('[data-action="confirm-yes"]', { timeout: 2000 }).catch(() => {});
  check('삭제 2차 확인(한 번 더)', /정말/.test(await A.locator('#modal-root').innerText()));
  await A.click('[data-action="confirm-yes"]');
  await settle(); await settle();
  const leftovers = Object.keys(server).filter(k => k.startsWith('groups/' + gid) || (k.startsWith('groupInvites/') && server[k].gid === gid));
  check('그룹 문서·하위 데이터·초대 코드까지 삭제', leftovers.length === 0, leftovers);
  check('삭제 후 A는 내 공간 + 남은 그룹(회사캠핑)만', await (async () => { await nav(A, 'gear'); return (await A.locator('.space-chip').count()) === 2 && (await A.locator('.space-chip.active:has-text("내 공간")').count()) === 1; })());
  check('다른 그룹(회사캠핑)은 그대로', !!server['groups/' + gid2] && !!inv2);

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
