// 안정화 묶음 테스트 (가짜 Firestore/Auth):
//  1) 삭제 되돌리기 — 개인/그룹 공간, 체크리스트 항목/리스트/장비/캠핑 기록, 필드(addedBy·updatedBy·assigneeUid·ownerUid) 보존
//  2) 그룹 백업(그룹장만) — 내보내기 → 가져오기 왕복, 잘못된 파일(개인 백업 포함) 거부
//  3) 새 버전 안내(APK만) — 빌드 번호 비교, 하루 한 번 확인, 받기(외부 브라우저), 닫기, 실패 시 조용히, Settings의 앱 버전
//  4) 예전 공유 경로(legacy)를 읽을 수 없어도(전환 기간 2단계) 앱이 정상 동작
// 실행: node tests/stability.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-stability-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
// 워크플로가 APK 빌드 때 만드는 파일 흉내(저장소에는 없음)
fs.mkdirSync(path.join(SITE, 'vendor'), { recursive: true });
fs.writeFileSync(path.join(SITE, 'vendor', 'build-info.js'), "window.CAMPBASE_BUILD = { number: 10, sha: 'abc1234' };\n");
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8770;
const URL0 = `http://127.0.0.1:${PORT}/`;
const API = 'https://api.github.com/repos/jskzoom4/CampBase/releases/latest';
const APK = 'https://github.com/jskzoom4/CampBase/releases/latest/download/campbase.apk';

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };

const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });   // 실패로 끝나도 서버를 남기지 않음(남으면 다음 실행이 예전 코드를 받음)
  await sleep(700);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const server = {};
  const pages = [];
  // opts.native: APK 흉내(네이티브 로그인 플러그인) / opts.release: GitHub API 응답 { status, tag } 또는 'abort'
  async function phone(user, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1300, height: 950 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
    ctx.__apiCalls = 0;
    ctx.__opened = [];
    await ctx.route(API, r => {
      ctx.__apiCalls++;
      const rel = opts.release || { status: 200, tag: 'build-10' };
      if (rel === 'abort') return r.abort();
      return r.fulfill({ status: rel.status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ tag_name: rel.tag }) });
    });
    await ctx.route('https://github.com/**', r => { ctx.__opened.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/plain', body: 'apk' }); });
    await ctx.exposeFunction('__fsDump', () => JSON.parse(JSON.stringify(server)));
    await ctx.exposeFunction('__fsWrite', async (p, d) => {
      if (d === null) delete server[p]; else server[p] = d;
      for (const pg of pages) { if (!pg.isClosed()) pg.evaluate(([p2, d2]) => window.__fsApply && window.__fsApply(p2, d2), [p, d]).catch(() => {}); }
    });
    if (opts.native) {
      await ctx.addInitScript(u => {
        window.__fakeTokenUsers = { ['tok-' + u.uid]: u };
        window.Capacitor = {
          isNativePlatform: () => true, getPlatform: () => 'android',
          Plugins: { FirebaseAuthentication: {
            signInWithGoogle: async () => ({ user: { uid: u.uid }, credential: { providerId: 'google.com', idToken: 'tok-' + u.uid } }),
            signOut: async () => {},
          } },
        };
      }, user);
    }
    if (opts.localState) await ctx.addInitScript(st => { if (!sessionStorage.getItem('__ls')) { Object.entries(st).forEach(([k, v]) => localStorage.setItem(k, v)); sessionStorage.setItem('__ls', '1'); } }, opts.localState);
    await ctx.addInitScript(u => { window.__fakePopupUser = u; }, user);
    await ctx.addInitScript(FAKE);
    if (opts.legacyClosed) await ctx.addInitScript(() => { window.__fakeLegacyClosed = true; });
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('NATIVE DIALOG'); d.dismiss(); });
    pages.push(page);
    await page.goto(URL0);
    await page.waitForSelector('#login-btn:not([disabled])', { timeout: 6000 });
    await page.click('[data-action="login-google"]');
    await page.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
    return page;
  }
  const settle = () => sleep(350);
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const toastText = p => p.locator('#toast').innerText();
  const confirmYes = async p => { await p.waitForSelector('[data-action="confirm-yes"]', { timeout: 3000 }); await p.click('[data-action="confirm-yes"]'); };
  const undo = async p => { await p.waitForSelector('#toast.show [data-action="undo-delete"]', { timeout: 3000 }); await p.click('#toast [data-action="undo-delete"]'); await settle(); };
  const pickSpace = async (p, label) => { await p.locator(`.space-chip:has-text("${label}")`).first().click(); await settle(); };
  const groupRow = (p, name) => p.locator(`.group-row:has-text("${name}")`).first();

  // ---- 미리 넣어둘 데이터: A의 개인 데이터 + A(그룹장)·B(멤버) 그룹 ----
  const A_ = 'users/' + UA.uid + '/';
  server[A_ + 'campingLogs/c1'] = { name: '홍천 강변 캠핑장', date: '2025-08-16', region: '홍천', siteType: '데크', siteSize: '5x5m', rating: 4, checkinTime: '14:00', checkoutTime: '11:00', toiletCondition: '좋음', storeCondition: '적당함', notes: '계곡 옆', extraField: { keep: true } };
  server[A_ + 'gear/g1'] = { name: '스텔스 5 텐트', brand: 'Snow Peak', category: '텐트', price: 520000, weight: 8.2, date: '2024-04-12' };
  server[A_ + 'checklists/cl1'] = { title: '기본 준비물', items: [
    { id: 'i1', label: '텐트', status: 'packed', group: '텐트/침구' },
    { id: 'i2', label: '침낭', status: 'pending', group: '텐트/침구' },
    { id: 'i3', label: '랜턴', status: 'skip', group: '조명' },
  ] };
  server[A_ + 'checklists/cl2'] = { title: '요리 준비물', items: [{ id: 'k1', label: '버너', status: 'pending', group: '조리' }] };
  const GID = 'grpFam';
  const G = 'groups/' + GID;
  server[G] = { name: '캠핑팸', ownerUid: UA.uid, memberUids: [UA.uid, UB.uid], createdAt: '2026-01-01T00:00:00Z', gearCategories: ['텐트', '타프', '기타'],
    members: { [UA.uid]: { name: '앨리스', photoURL: '', role: 'owner' }, [UB.uid]: { name: '밥', photoURL: '', role: 'member' } } };
  server[G + '/gear/gg1'] = { name: '공용 타프', brand: 'DOD', category: '타프', price: 0, weight: 3, date: '', addedBy: UB.uid, updatedBy: UA.uid, ownerUid: UB.uid };
  server[G + '/checklists/gl1'] = { title: '그룹 준비물', addedBy: UA.uid, updatedBy: UB.uid, items: [
    { id: 'a1', label: '버너', status: 'pending', group: '조리', addedBy: UA.uid, assigneeUid: UB.uid },
    { id: 'a2', label: '가스', status: 'packed', group: '조리', addedBy: UB.uid, assigneeUid: UA.uid },
    { id: 'a3', label: '아이스박스', status: 'pending', group: '기타', addedBy: UB.uid },
  ] };
  const before = JSON.parse(JSON.stringify(server));

  const A = await phone(UA);
  const B = await phone(UB, { mobile: true });

  // ================= 1. 되돌리기 — 개인 공간 =================
  await nav(A, 'checklist');
  await A.waitForSelector('.checklist-group:has-text("기본 준비물")');
  await menuClick(A, '.check-row:has-text("침낭") [data-action="cl-del-item"]');
  await settle();
  check('항목 삭제 → "삭제했어요 · 되돌리기" 토스트', /삭제했어요/.test(await toastText(A)) && (await A.locator('#toast.show [data-action="undo-delete"]').count()) === 1, await toastText(A));
  check('항목 삭제는 저장소에도 반영', server[A_ + 'checklists/cl1'].items.length === 2);
  await undo(A);
  check('되돌리기: 항목이 원래 위치(2번째)에 같은 내용으로 돌아옴', same(server[A_ + 'checklists/cl1'].items, before[A_ + 'checklists/cl1'].items), server[A_ + 'checklists/cl1'].items.map(i => i.label));
  check('되돌린 항목이 화면에도 보임', (await A.locator('.check-row:has-text("침낭")').count()) === 1);

  await menuClick(A, '.checklist-group:has-text("기본 준비물") [data-action="cl-del-list"]');
  await confirmYes(A);
  await settle();
  check('리스트 삭제(확인 후) → 저장소에서 사라짐 + 되돌리기 토스트', !server[A_ + 'checklists/cl1'] && (await A.locator('#toast.show [data-action="undo-delete"]').count()) === 1);
  await undo(A);
  check('되돌리기: 리스트가 같은 id·같은 내용으로 돌아옴', same(server[A_ + 'checklists/cl1'], before[A_ + 'checklists/cl1']));
  check('되돌린 리스트가 화면에 보임', (await A.locator('.checklist-group:has-text("기본 준비물")').count()) === 1);

  await nav(A, 'gear');
  await menuClick(A, '.list-row:has-text("스텔스 5 텐트") [data-action="gear-del"]');
  await confirmYes(A);
  await settle();
  check('장비 삭제 → 사라짐', !server[A_ + 'gear/g1'] && (await A.locator('.list-row:has-text("스텔스 5 텐트")').count()) === 0);
  await undo(A);
  check('되돌리기: 장비가 같은 id·같은 내용으로 돌아옴', same(server[A_ + 'gear/g1'], before[A_ + 'gear/g1']));

  await nav(A, 'camping');
  await menuClick(A, '.list-row:has-text("홍천 강변 캠핑장") [data-action="camp-del"]');
  check('캠핑 기록 삭제는 확인 모달 유지', /삭제할까요/.test(await A.locator('#modal-root').innerText()));
  await confirmYes(A);
  await settle();
  check('캠핑 기록 삭제 → 사라짐', !server[A_ + 'campingLogs/c1']);
  await undo(A);
  check('되돌리기: 캠핑 기록이 모든 필드(처음 보는 필드 포함) 그대로 돌아옴', same(server[A_ + 'campingLogs/c1'], before[A_ + 'campingLogs/c1']), server[A_ + 'campingLogs/c1']);
  check('되돌린 뒤 "되돌렸어요" 토스트', /되돌렸어요/.test(await toastText(A)), await toastText(A));

  // 연달아 두 개 지우면 마지막 것만 되돌림
  await nav(A, 'checklist');
  await menuClick(A, '.check-row:has-text("텐트") [data-action="cl-del-item"]');
  await settle();
  await menuClick(A, '.check-row:has-text("버너") [data-action="cl-del-item"]');
  await settle();
  await undo(A);
  check('연달아 지우면 마지막 삭제(버너)만 되돌림', server[A_ + 'checklists/cl2'].items.length === 1 && !server[A_ + 'checklists/cl1'].items.some(i => i.label === '텐트'));
  // 텐트는 원상 복구(이후 테스트용): 직접 저장소에 되돌림
  server[A_ + 'checklists/cl1'] = before[A_ + 'checklists/cl1'];
  for (const pg of pages) await pg.evaluate(([p, d]) => window.__fsApply(p, d), [A_ + 'checklists/cl1', before[A_ + 'checklists/cl1']]);

  // 5초가 지나면 되돌리기가 사라짐
  await menuClick(A, '.check-row:has-text("랜턴") [data-action="cl-del-item"]');
  await sleep(5400);
  check('5초가 지나면 되돌리기 버튼이 사라짐', (await A.locator('#toast.show [data-action="undo-delete"]').count()) === 0);
  check('되돌리기 시간이 지나면 삭제가 그대로 유지', !server[A_ + 'checklists/cl1'].items.some(i => i.id === 'i3'));

  // ================= 2. 되돌리기 — 그룹 공간 =================
  await nav(A, 'checklist');
  await pickSpace(A, '캠핑팸');
  await nav(B, 'checklist');
  await pickSpace(B, '캠핑팸');
  await menuClick(A, '.check-row:has-text("가스") [data-action="cl-del-item"]');
  await settle();
  check('그룹 항목 삭제 → B 화면에서도 사라짐', (await B.locator('.check-row:has-text("가스")').count()) === 0);
  await undo(A);
  const gl = server[G + '/checklists/gl1'];
  check('그룹 항목 되돌리기: 원래 위치 + assigneeUid·addedBy·status 그대로', same(gl.items, before[G + '/checklists/gl1'].items), gl.items);
  await B.waitForSelector('.check-row:has-text("가스")', { timeout: 3000 }).catch(() => {});
  check('되돌린 그룹 항목이 B에게도 실시간으로 보임', (await B.locator('.check-row:has-text("가스")').count()) === 1);

  const glBeforeDel = JSON.parse(JSON.stringify(server[G + '/checklists/gl1']));
  await menuClick(A, '.checklist-group:has-text("그룹 준비물") [data-action="cl-del-list"]');
  await confirmYes(A);
  await settle();
  check('그룹 리스트 삭제', !server[G + '/checklists/gl1']);
  await undo(A);
  check('그룹 리스트 되돌리기: addedBy·updatedBy·항목 담당자까지 같은 내용', same(server[G + '/checklists/gl1'], glBeforeDel) && glBeforeDel.addedBy === UA.uid, server[G + '/checklists/gl1']);

  await nav(A, 'gear');
  await menuClick(A, '.list-row:has-text("공용 타프") [data-action="gear-del"]');
  await confirmYes(A);
  await settle();
  check('그룹 장비 삭제', !server[G + '/gear/gg1']);
  await undo(A);
  check('그룹 장비 되돌리기: ownerUid·addedBy·updatedBy 그대로', same(server[G + '/gear/gg1'], before[G + '/gear/gg1']), server[G + '/gear/gg1']);
  await nav(B, 'gear');
  await B.waitForSelector('.list-row:has-text("공용 타프")', { timeout: 3000 }).catch(() => {});
  check('되돌린 그룹 장비가 B에게도 보임(주인 표시 포함)', (await B.locator('.list-row:has-text("공용 타프") .owner-tag:has-text("밥")').count()) === 1);

  // 지운 뒤 다른 공간으로 옮겨도 지운 그 공간에 되돌림
  await menuClick(A, '.list-row:has-text("공용 타프") [data-action="gear-del"]');
  await confirmYes(A);
  await settle();
  await pickSpace(A, '내 공간');
  await undo(A);
  check('공간을 바꾼 뒤 되돌려도 원래 그룹에 복구(내 공간에는 안 생김)', same(server[G + '/gear/gg1'], before[G + '/gear/gg1']) && !server[A_ + 'gear/gg1']);

  // ================= 3. 그룹 백업 =================
  await nav(A, 'settings');
  await nav(B, 'settings');
  check('그룹장에게만 그룹 백업 버튼', (await groupRow(A, '캠핑팸').locator('[data-action="group-backup-export"]').count()) === 1
    && (await groupRow(A, '캠핑팸').locator('[data-action="group-backup-import"]').count()) === 1
    && (await groupRow(B, '캠핑팸').locator('[data-action="group-backup-export"], [data-action="group-backup-import"]').count()) === 0);
  await menuClick(A, groupRow(A, '캠핑팸').locator('[data-action="group-backup-export"]'));
  await A.waitForSelector('#backup-text', { timeout: 3000 });
  const exported = await A.locator('#backup-text').inputValue();
  let ex = null; try { ex = JSON.parse(exported); } catch (e) {}
  check('그룹 백업 내보내기: { app:"campbase-group", version:1, groupName, gearCategories, checklists, gear }',
    ex && ex.app === 'campbase-group' && ex.version === 1 && !!ex.exportedAt && ex.groupName === '캠핑팸' && same(ex.gearCategories, ['텐트', '타프', '기타'])
    && ex.checklists.length === 1 && ex.gear.length === 1 && ex.gear[0].ownerUid === UB.uid && ex.checklists[0].items[0].assigneeUid === UB.uid, ex && Object.keys(ex));
  check('그룹 백업에는 멤버 정보가 없음', ex && !('members' in ex) && !('memberUids' in ex));
  await A.click('[data-action="modal-close"]');

  // 그룹 데이터를 바꿔 놓고(새 장비, 카테고리 변경, 리스트 삭제) 백업으로 되돌리기
  await nav(A, 'gear');
  await pickSpace(A, '캠핑팸');
  await A.click('[data-action="gear-new"]');
  await A.fill('#gf-name', '나중에 산 의자');
  await A.click('[data-action="gear-save"]');
  await settle();
  server[G] = { ...server[G], gearCategories: ['텐트', '기타'] };
  for (const pg of pages) await pg.evaluate(([p, d]) => window.__fsApply(p, d), [G, server[G]]);
  delete server[G + '/checklists/gl1'];
  for (const pg of pages) await pg.evaluate(p => window.__fsApply(p, null), G + '/checklists/gl1');
  await settle();
  const newGearKey = Object.keys(server).find(k => k.startsWith(G + '/gear/') && server[k].name === '나중에 산 의자');
  check('(준비) 그룹 데이터가 바뀜', !!newGearKey && !server[G + '/checklists/gl1']);

  await nav(A, 'settings');
  await menuClick(A, groupRow(A, '캠핑팸').locator('[data-action="group-backup-import"]'));
  // 잘못된 파일 거부
  await A.fill('#group-backup-text-in', '{"app":"campbase","version":1,"gear":[]}');
  await A.click('[data-action="group-backup-import-go"]');
  check('개인 백업 파일은 그룹 백업으로 가져오기 거부', /개인 백업/.test(await toastText(A)) && (await A.locator('[data-action="confirm-yes"]').count()) === 0, await toastText(A));
  await A.fill('#group-backup-text-in', '이건 백업이 아님');
  await A.click('[data-action="group-backup-import-go"]');
  check('JSON이 아니면 거부', /읽지 못했어요/.test(await toastText(A)) && (await A.locator('[data-action="confirm-yes"]').count()) === 0);
  await A.fill('#group-backup-text-in', '{"app":"other","checklists":[]}');
  await A.click('[data-action="group-backup-import-go"]');
  check('다른 앱 파일 거부', /그룹 백업 파일이 아니에요/.test(await toastText(A)) && (await A.locator('[data-action="confirm-yes"]').count()) === 0);
  // 파일 선택으로 불러오기
  const bf = path.join(SITE, 'group-backup.json');
  fs.writeFileSync(bf, exported);
  await A.setInputFiles('#group-backup-file', bf);
  await A.waitForFunction(() => document.getElementById('group-backup-text-in').value.length > 10, null, { timeout: 3000 });
  check('파일 선택하면 내용이 채워짐', (await A.locator('#group-backup-text-in').inputValue()) === exported);
  await A.click('[data-action="group-backup-import-go"]');
  const confirmText = await A.locator('#modal-root').innerText();
  check('가져오기 전 개수를 보여주는 확인 모달', /체크리스트 1개, 장비 1개, 장비 카테고리 3개/.test(confirmText), confirmText);
  await confirmYes(A);
  await settle(); await settle();
  const gearKeys = Object.keys(server).filter(k => k.startsWith(G + '/gear/'));
  check('가져오기: 백업에 없던 장비는 지워지고 백업 장비만 남음', gearKeys.length === 1 && same(server[G + '/gear/gg1'], before[G + '/gear/gg1']), gearKeys);
  const { id: _exId, ...exList } = ex.checklists[0];
  check('가져오기: 지워졌던 리스트가 같은 id·내용(백업 그대로)으로 돌아옴', _exId === 'gl1' && same(server[G + '/checklists/gl1'], exList) && same(exList.items, before[G + '/checklists/gl1'].items));
  check('가져오기: 장비 카테고리 복구', same(server[G].gearCategories, ['텐트', '타프', '기타']));
  check('가져오기: 멤버·그룹 이름·그룹장은 그대로', server[G].name === '캠핑팸' && same(server[G].memberUids, before[G].memberUids) && same(server[G].members, before[G].members) && server[G].ownerUid === UA.uid);
  await nav(B, 'checklist');
  await pickSpace(B, '캠핑팸');
  check('B 화면에도 복구된 리스트가 보임', (await B.locator('.checklist-group:has-text("그룹 준비물")').count()) === 1);
  // 개인 백업 가져오기에 그룹 백업을 넣으면 거부
  await nav(A, 'settings');
  await A.click('[data-action="backup-import"]');
  await A.fill('#backup-text-in', exported);
  await A.click('[data-action="backup-import-go"]');
  check('개인 백업 가져오기에 그룹 백업 파일을 넣으면 거부', /그룹 백업 파일이에요/.test(await toastText(A)) && (await A.locator('[data-action="confirm-yes"]').count()) === 0, await toastText(A));
  await A.click('[data-action="modal-close"]');
  // 멤버가 규칙을 우회해 그룹 백업 버튼을 눌러도(직접 호출) 아무 일도 없음
  const bTry = await B.evaluate(gid => { try { exportGroupBackup(gid); importGroupBackupModal(gid); return document.getElementById('modal-root').innerHTML.length; } catch (e) { return 'ERR ' + e.message; } }, GID);
  check('멤버는 그룹 백업 기능을 쓸 수 없음', bTry === 0, bTry);

  // ================= 4. 앱 버전 / 새 버전 안내 =================
  await nav(A, 'settings');
  check('웹: Settings 맨 아래 "웹 버전"', (await A.locator('#app-version').innerText()) === '웹 버전');
  const webCalls = await A.context().__apiCalls;
  check('웹에서는 새 버전 확인을 하지 않음', webCalls === 0 && !(await A.locator('#update-banner.show').count()), webCalls);

  const N1 = await phone({ uid: 'uidN1', displayName: '폰1', email: 'n1@example.com' }, { native: true, mobile: true, release: { status: 200, tag: 'build-12' } });
  await N1.waitForSelector('#update-banner.show', { timeout: 4000 }).catch(() => {});
  check('APK: 최신 Release(build-12) > 내 빌드(10) → "새 버전이 있어요" 배너', (await N1.locator('#update-banner.show').count()) === 1 && /새 버전이 있어요/.test(await N1.locator('#update-banner').innerText()));
  await nav(N1, 'settings');
  check('APK: Settings에 "앱 버전: 빌드 10"', (await N1.locator('#app-version').innerText()) === '앱 버전: 빌드 10', await N1.locator('#app-version').innerText());
  const saved = await N1.evaluate(() => JSON.parse(localStorage.getItem('campbase.updateCheck')));
  check('확인 결과를 기기에 기억(하루 한 번 확인용)', saved && saved.latest === 12 && Date.now() - saved.at < 60000, saved);
  const req = N1.waitForRequest(APK, { timeout: 4000 }).catch(() => null);
  await N1.click('[data-action="update-get"]');
  check('받기: 최신 APK 링크를 앱 밖(외부 브라우저)으로 열기', !!(await req));

  // 같은 날 다시 열면 API를 또 부르지 않고 기억한 결과로 배너 표시 / 닫으면 그 버전은 다시 안 보임
  const N2 = await phone({ uid: 'uidN2', displayName: '폰2', email: 'n2@example.com' }, { native: true, mobile: true, release: { status: 200, tag: 'build-13' },
    localState: { 'campbase.updateCheck': JSON.stringify({ at: Date.now() - 3600 * 1000, latest: 12 }) } });
  await N2.waitForSelector('#update-banner.show', { timeout: 4000 }).catch(() => {});
  check('하루 안에 다시 열면 API를 부르지 않고(기억한 build-12) 배너 표시', N2.context().__apiCalls === 0 && /빌드 12/.test(await N2.locator('#update-banner').innerText()), N2.context().__apiCalls);
  await N2.click('[data-action="update-dismiss"]');
  check('배너 닫기', (await N2.locator('#update-banner.show').count()) === 0);
  await N2.reload();
  await N2.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
  await sleep(600);
  check('닫은 버전은 다시 열어도 배너 안 보임', (await N2.locator('#update-banner.show').count()) === 0);

  const N3 = await phone({ uid: 'uidN3', displayName: '폰3', email: 'n3@example.com' }, { native: true, release: { status: 200, tag: 'build-10' },
    localState: { 'campbase.updateCheck': JSON.stringify({ at: Date.now() - 25 * 3600 * 1000, latest: 9 }) } });
  await sleep(800);
  check('하루가 지나면 다시 확인 + 최신이 내 빌드와 같으면 배너 없음', N3.context().__apiCalls === 1 && (await N3.locator('#update-banner.show').count()) === 0, N3.context().__apiCalls);

  const N4 = await phone({ uid: 'uidN4', displayName: '폰4', email: 'n4@example.com' }, { native: true, release: { status: 500, tag: 'x' } });
  const N5 = await phone({ uid: 'uidN5', displayName: '폰5', email: 'n5@example.com' }, { native: true, release: 'abort' });
  const N6 = await phone({ uid: 'uidN6', displayName: '폰6', email: 'n6@example.com' }, { native: true, release: { status: 200, tag: 'v2.0' } });
  await sleep(800);
  const quiet = async p => (await p.locator('#update-banner.show').count()) === 0 && !/오류|실패|fail/i.test(await toastText(p));
  check('확인 실패(서버 오류·연결 끊김·이상한 태그)는 조용히 넘어감', await quiet(N4) && await quiet(N5) && await quiet(N6));
  check('확인 실패 결과는 기억하지 않음(다음에 다시 확인)', (await N4.evaluate(() => localStorage.getItem('campbase.updateCheck'))) === null);

  // 그룹 나가기는 되돌리기 대상이 아님(확인 모달만)
  await nav(B, 'settings');
  await menuClick(B, groupRow(B, '캠핑팸').locator('[data-action="group-leave"]'));
  await confirmYes(B);
  await settle();
  check('그룹 나가기 후에는 되돌리기 버튼 없음', !server[G].memberUids.includes(UB.uid) && (await B.locator('#toast [data-action="undo-delete"]').count()) === 0);

  // ================= 5. legacy를 읽을 수 없어도(전환 기간 2단계) 정상 동작 =================
  server['gear/legacyG'] = { name: '예전 공유 장비', category: '텐트' };
  const L = await phone({ uid: 'uidLate', displayName: '늦은', email: 'late@example.com' }, { legacyClosed: true });
  await nav(L, 'settings');
  await sleep(400);
  check('legacy 닫힘: 가져오기 버튼 숨김, 오류 토스트 없음', (await L.locator('[data-action="legacy-import"]').count()) === 0 && !/거부|오류|권한/.test(await toastText(L)));
  await nav(L, 'camping');
  await L.click('[data-action="camp-new"]');
  await L.fill('#cf-name', '새 캠핑장');
  await L.click('[data-action="camp-save"]');
  await nav(L, 'gear');
  await L.click('[data-action="gear-new"]');
  await L.fill('#gf-name', '새 랜턴');
  await L.click('[data-action="gear-save"]');
  await settle();
  const lKeys = Object.keys(server).filter(k => k.startsWith('users/uidLate/'));
  check('legacy 닫힘: 캠핑 기록·장비 저장 정상', lKeys.some(k => k.includes('/campingLogs/')) && lKeys.some(k => k.includes('/gear/')), lKeys);

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
