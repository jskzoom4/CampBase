// 앱(docs/index.html) 전체 동작 테스트: 구글 로그인 + 사람별 개인 공간.
// 실제 Firebase 대신 같은 API를 흉내 낸 가짜 Firestore/Auth(tests/fake-firestore.js)를 쓰고,
// 데이터는 이 테스트 러너가 보관한다 → 브라우저 컨텍스트 여러 개 = 여러 사람(또는 한 사람의 여러 기기)의 폰.
// 가짜 저장소도 firestore.rules와 같은 규칙(users/{uid}는 본인만)을 흉내 낸다.
// 실행: node tests/shared-app.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const BACKUP = path.join(__dirname, 'fixtures', 'sample-backup.json');

// docs/를 임시 폴더 두 곳에 복사: 하나는 테스트용 설정값, 하나는 "설정 전" 상태
function prepareSite(name, configJs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
  fs.cpSync(path.join(ROOT, 'docs'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'firebase-config.js'), configJs);
  return dir;
}
const CONFIGURED = prepareSite('campbase-configured',
  'const firebaseConfig = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", storageBucket: "x", messagingSenderId: "1", appId: "1:1:web:1" };\nwindow.FIREBASE_CONFIG = firebaseConfig;\n');
const UNCONFIGURED = prepareSite('campbase-unconfigured',
  'const firebaseConfig = { apiKey: "여기에-붙여넣기", projectId: "여기에-붙여넣기" };\nwindow.FIREBASE_CONFIG = firebaseConfig;\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

const PHOTO = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: PHOTO };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const UN = { uid: 'uidNative', displayName: '네이티브', email: 'native@example.com', photoURL: PHOTO };

const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv1 = spawn('python3', ['-m', 'http.server', '8765', '-d', CONFIGURED], { stdio: 'ignore' });
  const srv2 = spawn('python3', ['-m', 'http.server', '8766', '-d', UNCONFIGURED], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});

  // ---- the shared "server" (one Firebase project) ----
  const server = {};
  const pages = [];
  async function newPhone(opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1300, height: 950 } });
    // 외부 폰트는 테스트와 무관 → 빈 응답
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
    await ctx.exposeFunction('__fsDump', () => JSON.parse(JSON.stringify(server)));
    await ctx.exposeFunction('__fsWrite', async (p, d) => {
      if (d === null) delete server[p]; else server[p] = d;
      for (const pg of pages) { if (!pg.isClosed()) pg.evaluate(([p2, d2]) => window.__fsApply && window.__fsApply(p2, d2), [p, d]).catch(() => {}); }
    });
    // 이미 로그인해 둔 기기(로그인 유지) 흉내
    if (opts.signedIn) await ctx.addInitScript(u => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem('__fakeAuthUser', JSON.stringify(u)); sessionStorage.setItem('__seeded', '1'); } }, opts.signedIn);
    if (opts.user) await ctx.addInitScript(u => { window.__fakePopupUser = u; }, opts.user);
    if (opts.native) {
      // APK(Capacitor) 흉내: 네이티브 구글 로그인 플러그인이 idToken을 돌려줌
      await ctx.addInitScript(u => {
        window.__nativeCalls = [];
        window.__fakeTokenUsers = { ['native-id-token-' + u.uid]: u };
        window.Capacitor = {
          isNativePlatform: () => true, getPlatform: () => 'android',
          Plugins: { FirebaseAuthentication: {
            signInWithGoogle: async () => { window.__nativeCalls.push('signInWithGoogle'); return { user: { uid: u.uid }, credential: { providerId: 'google.com', idToken: 'native-id-token-' + u.uid } }; },
            signOut: async () => { window.__nativeCalls.push('signOut'); },
          } },
        };
      }, opts.native);
    }
    if (!opts.noFake) await ctx.addInitScript(FAKE);
    // SDK를 못 불러오는 상황(오프라인 첫 실행)을 네트워크와 무관하게 재현
    if (opts.brokenSdk) await ctx.addInitScript(() => { window.__FIREBASE_MODULES__ = { app: { getApps: () => [], initializeApp() { throw new Error('offline: SDK unavailable'); } }, firestore: {}, auth: {} }; });
    const page = await ctx.newPage();
    page.__errors = [];
    page.on('pageerror', e => page.__errors.push(e.message));
    page.on('dialog', d => { page.__errors.push('NATIVE DIALOG'); d.dismiss(); });
    if (opts.denied) await page.addInitScript(() => { const t = setInterval(() => { if (window.__FIREBASE_MODULES__) { window.__fakeDenied = true; clearInterval(t); } }, 1); });
    pages.push(page);
    await page.goto(opts.url || 'http://127.0.0.1:8765/');
    return page;
  }
  const status = p => p.locator('#db-status').innerText();
  const statusTop = p => p.locator('#db-status-top').innerText();
  const waitStatus = (p, re, t = 8000) => p.waitForFunction(r => new RegExp(r).test(document.getElementById('db-status').textContent), re.source, { timeout: t });
  const loginVisible = p => p.locator('#login-screen').isVisible();
  const waitLoginReady = p => p.waitForSelector('#login-btn:not([disabled])', { timeout: 6000 });
  async function login(p) {
    await waitLoginReady(p);
    await p.click('[data-action="login-google"]');
    await waitStatus(p, /자동 저장 켜짐/);
  }
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const userKeys = uid => Object.keys(server).filter(k => k.startsWith('users/' + uid + '/')).sort();
  // 이 페이지가 건드린 경로가 전부 자기 개인 공간인지 (legacy 가져오기 전 기준)
  const foreignAccess = (p, uid) => p.evaluate(u => window.__fsAccess.filter(x => x !== 'users/' + u && !x.startsWith('users/' + u + '/') && x !== 'groups'), uid);   // 'groups' = 내 그룹 목록 쿼리

  // 전환 기간: 예전 APK가 쓰던 최상위 공유 데이터가 이미 있다고 가정
  Object.assign(server, {
    'campingLogs/c1': { name: '예전 공유 캠핑장(같은 id)', region: '홍천', date: '2024-01-01' },
    'campingLogs/legacyCamp': { name: '예전 공유 캠핑장', region: '양양', date: '2024-06-01' },
    'gear/legacyGear': { name: '예전 공유 해먹', category: '해먹', brand: '기타' },
    'checklists/legacyList': { title: '예전 공유 리스트', items: [{ id: 'li1', label: '버너', status: 'packed', group: '조리' }] },
    'cookingChecks/ck1': { checked: [0, 2] },
    'app/settings': { weatherLocation: { name: '춘천', lat: 37.88, lng: 127.73 }, gearCategories: ['텐트', '해먹', '기타'] },
  });
  const legacySnapshot = JSON.stringify(Object.fromEntries(Object.entries(server).filter(([k]) => !k.startsWith('users/'))));

  // ================= 1. 로그인 전 화면 =================
  const A = await newPhone({ user: UA });
  await waitLoginReady(A);
  check('로그인 전: 로그인 화면만 보임', await loginVisible(A) && !(await A.locator('#app').isVisible()));
  const loginText = await A.locator('#login-screen').innerText();
  check('로그인 화면: 앱 이름·소개·Google로 시작하기 버튼', /캠프베이스/.test(loginText) && /캠핑/.test(loginText) && /Google로 시작하기/.test(loginText), loginText.slice(0, 60));
  check('로그인 전에는 저장소를 읽거나 쓰지 않음', (await A.evaluate(() => window.__fsAccess.length)) === 0 && userKeys(UA.uid).length === 0);
  check('웹: getAuth 사용(팝업 로그인 지원)', (await A.evaluate(() => window.__fakeAuthInit && window.__fakeAuthInit.kind)) === 'getAuth');

  // 로그인 취소
  await A.evaluate(() => { window.__savedPopupUser = window.__fakePopupUser; window.__fakePopupUser = null; });
  await A.click('[data-action="login-google"]');
  await A.waitForFunction(() => /취소/.test(document.getElementById('login-msg').textContent), null, { timeout: 3000 }).catch(() => {});
  check('팝업을 닫으면 안내 문구 + 로그인 화면 유지', /로그인을 취소했어요/.test(await A.locator('#login-msg').innerText()) && await loginVisible(A));
  await A.evaluate(() => { window.__fakePopupUser = window.__savedPopupUser; });

  // 로그인
  await login(A);
  check('웹: signInWithPopup + GoogleAuthProvider로 로그인', (await A.evaluate(() => window.__fakePopupCalls)) === 2 && (await A.evaluate(() => window.__fakeLastProvider.providerId)) === 'google.com');
  check('로그인 후 앱 화면으로 전환', !(await loginVisible(A)) && await A.locator('#app').isVisible());
  check('상태 표시: 내 계정에 저장', /내 계정/.test(await status(A)), await status(A));
  check('Firestore 오프라인 캐시 설정 사용', await A.evaluate(() => window.__fsSettings && window.__fsSettings.localCache && window.__fsSettings.localCache.kind === 'persistent'));
  await sleep(300);
  const prof = server['users/' + UA.uid];
  check('users/{uid} 문서에 name·email·photoURL·updatedAt 저장', prof && prof.name === '앨리스' && prof.email === 'alice@example.com' && prof.photoURL === PHOTO && !!prof.updatedAt, prof);
  check('빈 개인 공간에 예시 데이터를 자동으로 쓰지 않음', userKeys(UA.uid).length === 0, userKeys(UA.uid));
  check('로그인해도 예전 공유 데이터는 자동으로 보이지 않음', await (async () => { await nav(A, 'camping'); return (await A.locator('.list-row').count()) === 0; })());
  check('설정 있음 → 미리보기 배너 없음', (await A.locator('.preview-banner').count()) === 0);

  // Settings: 내 계정
  await nav(A, 'settings');
  const acct = await A.locator('#account-card').innerText();
  check('Settings에 내 계정(이름·이메일) + 로그아웃 버튼', /앨리스/.test(acct) && /alice@example.com/.test(acct) && (await A.locator('#account-card [data-action="logout"]').count()) === 1, acct);
  check('Settings에 계정 사진 표시', (await A.locator('#account-card img.account-photo').getAttribute('src')) === PHOTO);
  check('Settings에 "기존 공유 데이터 가져오기" 버튼', (await A.locator('[data-action="legacy-import"]').count()) === 1);

  // ================= 2. 같은 계정의 두 기기 실시간 동기화 =================
  const A2 = await newPhone({ mobile: true, signedIn: UA });
  await waitStatus(A2, /자동 저장 켜짐/);
  check('로그인 유지: 저장된 로그인으로 바로 앱이 열림', !(await loginVisible(A2)));
  check('A2(모바일): 상단 상태 표시 보임', await A2.locator('#db-status-top').isVisible() && /내 계정/.test(await statusTop(A2)));

  await nav(A, 'checklist');
  await A.click('[data-action="cl-new-list"]');
  await A.fill('#ncl-title', '공유테스트');
  await A.click('[data-action="cl-new-list-save"]');
  await A.click('.checklist-group:has-text("공유테스트") [data-action="cl-add-item"]');
  await A.fill('#cli-label', '랜턴'); await A.fill('#cli-group', '조명');
  await A.click('[data-action="cl-add-item-save"]');
  await sleep(400);
  check('체크리스트가 users/{uid}/checklists 아래에 저장', userKeys(UA.uid).some(k => k.startsWith('users/' + UA.uid + '/checklists/')) && !Object.keys(server).some(k => k.startsWith('checklists/') && server[k].title === '공유테스트'), userKeys(UA.uid));
  await nav(A2, 'checklist');
  await A2.waitForSelector('.checklist-group:has-text("공유테스트") .check-row:has-text("랜턴")', { timeout: 3000 }).catch(() => {});
  check('A가 만든 리스트·항목이 같은 계정의 A2에 나타남', await A2.locator('.checklist-group:has-text("공유테스트") .check-row:has-text("랜턴")').count() === 1);

  await A2.click('.check-row:has-text("랜턴") [data-action="cl-item-status"][data-val="packed"]');
  await A.waitForSelector('.check-row:has-text("랜턴") .cl-status-btn.packed.active', { timeout: 3000 }).catch(() => {});
  check('A2가 체크한 내용이 A 화면에 실시간 반영', await A.locator('.check-row:has-text("랜턴") .cl-status-btn.packed.active').count() === 1);
  check('A 화면 대분류에 완료 배지', await A.locator('.checklist-group:has-text("공유테스트") .done-tag').count() === 1);

  await A.click('.checklist-group:has-text("공유테스트") [data-action="cl-list-rename"]');
  await A.fill('#cl-title-name', '공유테스트-이름변경');
  await A.click('[data-action="cl-list-rename-save"]');
  await A2.waitForSelector('.checklist-group h3:has-text("공유테스트-이름변경")', { timeout: 3000 }).catch(() => {});
  check('리스트 이름 변경도 A2에 반영', await A2.locator('.checklist-group h3:has-text("공유테스트-이름변경")').count() === 1);

  // ================= 3. 다른 사람(B)은 A의 데이터를 못 봄 =================
  const B = await newPhone({ user: UB });
  await login(B);
  await nav(B, 'checklist');
  await sleep(300);
  check('B에게는 A의 체크리스트가 안 보임', (await B.locator('.checklist-group').count()) === 0);
  await nav(B, 'gear');
  await B.click('[data-action="gear-new"]');
  await B.fill('#gf-name', '밥의 버너');
  await B.click('[data-action="gear-save"]');
  await sleep(400);
  check('B의 장비는 users/{B uid}/gear 아래에 저장', userKeys(UB.uid).some(k => k.startsWith('users/' + UB.uid + '/gear/')));
  await nav(A, 'gear');
  await sleep(300);
  check('A에게는 B의 장비가 안 보임', (await A.locator('.list-row:has-text("밥의 버너")').count()) === 0);
  await nav(A, 'home');
  await nav(B, 'home');
  const bHome = await B.locator('#main').innerText();
  check('Home 대시보드도 내 데이터만 (B: 장비 1, 체크 항목 없음)', /보유 장비[\s\S]*1/.test(bHome) && /체크리스트 항목이 없어요/.test(bHome), bHome.replace(/\s+/g, ' ').slice(0, 160));
  check('A는 자기 공간 경로만 접근', (await foreignAccess(A, UA.uid)).length === 0, await foreignAccess(A, UA.uid));
  check('B는 자기 공간 경로만 접근', (await foreignAccess(B, UB.uid)).length === 0, await foreignAccess(B, UB.uid));
  const bDenied = await B.evaluate(async () => {
    const m = window.__FIREBASE_MODULES__.firestore;
    try { await m.getDocs(m.collection({}, 'users/uidAlice/checklists')); return 'read-ok'; } catch (e) { return e.code; }
  });
  check('(가짜 규칙) B가 A의 공간을 직접 읽으면 거부', bDenied === 'permission-denied', bDenied);

  // ================= 4. Home 위젯 설정은 계정 기준 =================
  await nav(A, 'settings');
  await A.locator('label.switch').first().click();
  await sleep(400);
  await nav(A, 'home');
  await nav(A2, 'home');
  await A2.waitForFunction(() => document.querySelectorAll('.weather-widget').length === 0, null, { timeout: 3000 }).catch(() => {});
  const aLoc = await A.locator('.weather-widget').count(), a2Loc = await A2.locator('.weather-widget').count(), bLoc = await B.locator('.weather-widget').count();
  check('Home 위젯 끄기는 같은 계정의 모든 기기에 적용, 다른 사람은 그대로', aLoc === 0 && a2Loc === 0 && bLoc === 1, { aLoc, a2Loc, bLoc });
  const aSet = server['users/' + UA.uid + '/settings/app'];
  check('위젯 설정은 users/{uid}/settings/app.homeWidgets에 저장', aSet && aSet.homeWidgets && aSet.homeWidgets.location === false, aSet);
  check('위젯 설정을 기기(localStorage)에 따로 저장하지 않음', (await A.evaluate(() => localStorage.getItem('campbase.homeWidgets'))) === null);
  await A.reload(); await waitStatus(A, /자동 저장/);
  check('새로고침해도 로그인 유지 + 위젯 설정 유지', !(await loginVisible(A)) && await A.locator('.weather-widget').count() === 0);

  // ================= 5. 백업 내보내기/가져오기 (개인 공간 기준) =================
  await nav(A, 'settings');
  await A.click('[data-action="backup-export"]');
  const exported = await A.inputValue('#backup-text');
  let exp = null; try { exp = JSON.parse(exported); } catch (e) {}
  check('백업 내보내기: 올바른 JSON + 내 리스트만 포함', exp && exp.app === 'campbase' && exp.checklists.some(c => c.title === '공유테스트-이름변경') && exp.gear.length === 0 && exp.settings.homeWidgets.location === false);
  await A.click('[data-action="modal-close"]');

  await A.click('[data-action="backup-import"]');
  await A.setInputFiles('#backup-file', BACKUP);
  await A.waitForFunction(() => (document.getElementById('backup-text-in') || {}).value.length > 50, null, { timeout: 3000 });
  await A.click('[data-action="backup-import-go"]');
  const confirmText = await A.locator('#modal-root').innerText();
  check('가져오기 전 확인 모달에 개수 표시', /캠핑 기록 2개, 장비 3개, 체크리스트 1개/.test(confirmText), confirmText.slice(0, 80));
  await A.click('[data-action="confirm-yes"]');
  await sleep(800);
  await nav(A2, 'checklist');
  await A2.waitForSelector('.checklist-group h3:has-text("10/4-5")', { timeout: 3000 }).catch(() => {});
  check('가져온 체크리스트(10/4-5)가 A2에 보임', await A2.locator('.checklist-group h3:has-text("10/4-5")').count() === 1);
  check('가져오기 전 리스트는 교체되어 사라짐', await A2.locator('.checklist-group h3:has-text("공유테스트")').count() === 0);
  await nav(A2, 'camping');
  check('가져온 캠핑 기록 2개가 A2에 보임', await A2.locator('.list-row .name').count() === 2);
  const aKeys = userKeys(UA.uid);
  check('A의 개인 공간 내용이 백업과 일치', aKeys.filter(k => k.includes('/campingLogs/')).length === 2 && aKeys.filter(k => k.includes('/gear/')).length === 3 && aKeys.filter(k => k.includes('/checklists/')).length === 1, aKeys);
  check('백업 가져오기는 B의 공간·예전 공유 데이터를 건드리지 않음', userKeys(UB.uid).filter(k => k.includes('/gear/')).length === 1 && JSON.stringify(Object.fromEntries(Object.entries(server).filter(([k]) => !k.startsWith('users/')))) === legacySnapshot);
  check('백업의 위젯 설정이 계정에 저장', server['users/' + UA.uid + '/settings/app'].homeWidgets.camping === false);

  await A.click('[data-action="backup-import"]');
  await A.fill('#backup-text-in', '{"hello":1}');
  await A.click('[data-action="backup-import-go"]');
  await sleep(200);
  check('캠프베이스 백업이 아니면 거부', /백업 파일이 아니에요/.test(await A.locator('#toast').innerText()) && (await A.locator('[data-action="confirm-yes"]').count()) === 0);
  await A.click('[data-action="modal-close"]');

  // ================= 6. 기존 공유 데이터 가져오기 =================
  const aCampBefore = JSON.stringify(server['users/' + UA.uid + '/campingLogs/c1']);
  await A.click('[data-action="legacy-import"]');
  await A.waitForSelector('[data-action="confirm-yes"]', { timeout: 3000 }).catch(() => {});
  const legacyConfirm = await A.locator('#modal-root').innerText();
  check('가져오기 확인 모달에 legacy 개수 표시', /캠핑 기록 2개, 장비 1개, 체크리스트 1개, 요리 재료 체크 1개/.test(legacyConfirm), legacyConfirm.slice(0, 120));
  check('확인 모달에 건너뛸 개수(같은 id 1개) 안내', /이미 있는 1개/.test(legacyConfirm));
  await A.click('[data-action="confirm-yes"]');
  await sleep(600);
  const aKeys2 = userKeys(UA.uid);
  check('legacy 항목이 내 공간으로 복사됨', ['campingLogs/legacyCamp', 'gear/legacyGear', 'checklists/legacyList', 'cookingChecks/ck1'].every(k => aKeys2.includes('users/' + UA.uid + '/' + k)), aKeys2);
  check('같은 id(c1)는 덮어쓰지 않고 건너뜀', JSON.stringify(server['users/' + UA.uid + '/campingLogs/c1']) === aCampBefore);
  check('가져오기 결과 토스트(복사 4개, 건너뜀 1개)', /4개를 내 공간으로 가져왔어요.*1개는 건너뜀/.test(await A.locator('#toast').innerText()), await A.locator('#toast').innerText());
  check('원본(최상위 공유 데이터)은 그대로', JSON.stringify(Object.fromEntries(Object.entries(server).filter(([k]) => !k.startsWith('users/')))) === legacySnapshot);
  check('legacy 장비 카테고리(해먹)가 내 카테고리에 합쳐짐', (server['users/' + UA.uid + '/settings/app'].gearCategories || []).includes('해먹') && server['users/' + UA.uid + '/settings/app'].gearCategories.slice(-1)[0] === '기타', server['users/' + UA.uid + '/settings/app'].gearCategories);
  await nav(A2, 'camping');
  await A2.waitForSelector('.list-row:has-text("예전 공유 캠핑장")', { timeout: 3000 }).catch(() => {});
  check('가져온 기록이 같은 계정의 다른 기기에도 보임', await A2.locator('.list-row:has-text("예전 공유 캠핑장")').count() === 1);
  check('B에게는 A가 가져온 legacy 데이터가 안 보임', userKeys(UB.uid).every(k => !/legacy/.test(k)));

  await nav(A, 'settings');
  await A.click('[data-action="legacy-import"]');
  await A.waitForSelector('[data-action="confirm-yes"]', { timeout: 3000 }).catch(() => {});
  await A.click('[data-action="confirm-yes"]');
  await sleep(400);
  check('두 번 가져와도 중복 없이 전부 건너뜀', /0개를 내 공간으로 가져왔어요.*5개는 건너뜀/.test(await A.locator('#toast').innerText()) && userKeys(UA.uid).length === aKeys2.length, await A.locator('#toast').innerText());

  await A.evaluate(() => { window.__fakeLegacyClosed = true; });
  await A.click('[data-action="legacy-import"]');
  await sleep(300);
  check('공유 저장소가 닫힌 뒤에는 안내 토스트', /읽을 수 없어요/.test(await A.locator('#toast').innerText()) && (await A.locator('[data-action="confirm-yes"]').count()) === 0, await A.locator('#toast').innerText());
  await A.evaluate(() => { window.__fakeLegacyClosed = false; });

  // ================= 7. 오프라인 / 권한 거부 =================
  await A.evaluate(() => { window.__fakeOffline = true; window.__fakeEmitAll(); });
  await sleep(3500);
  check('오프라인 3초 이상이면 오프라인 표시', /오프라인/.test(await status(A)), await status(A));
  await A.evaluate(() => { window.__fakeOffline = false; window.__fakeEmitAll(); });
  await sleep(200);
  check('연결되면 다시 자동 저장 표시', /자동 저장 켜짐/.test(await status(A)), await status(A));

  const C = await newPhone({ signedIn: { uid: 'uidCarol', displayName: '캐롤', email: 'c@example.com' }, denied: true });
  await C.waitForFunction(() => /규칙/.test(document.getElementById('toast').textContent), null, { timeout: 6000 }).catch(() => {});
  check('규칙 미게시(권한 거부) 시 안내 토스트', /Firestore 규칙/.test(await C.locator('#toast').innerText()), await C.locator('#toast').innerText());

  // ================= 8. 로그아웃 → 다른 계정으로 로그인 =================
  await nav(A, 'settings');
  await A.click('[data-action="logout"]');
  check('로그아웃은 확인 모달(confirmModal)로 물어봄', /로그아웃할까요/.test(await A.locator('#modal-root').innerText()));
  await A.click('[data-action="confirm-yes"]');
  await A.waitForSelector('#login-screen', { state: 'visible', timeout: 3000 }).catch(() => {});
  check('로그아웃하면 로그인 화면으로', await loginVisible(A) && !(await A.locator('#app').isVisible()));
  check('로그아웃 후 화면에서 내 데이터가 지워짐', await A.evaluate(() => !document.getElementById('main').innerText.includes('예전 공유 캠핑장')));
  check('로그아웃 후 실시간 구독이 모두 해제됨', (await A.evaluate(() => window.__fakeListenerCount())) === 0, await A.evaluate(() => window.__fakeListenerCount()));
  await A.reload();
  await waitLoginReady(A);
  check('로그아웃 상태는 새로고침 후에도 유지', await loginVisible(A));
  await A.evaluate(u => { window.__fakePopupUser = u; window.__fsAccess = []; }, UB);
  await login(A);
  await nav(A, 'gear');
  await A.waitForSelector('.list-row:has-text("밥의 버너")', { timeout: 3000 }).catch(() => {});
  check('같은 기기에서 B로 로그인하면 B의 데이터만 보임', await A.locator('.list-row:has-text("밥의 버너")').count() === 1 && await A.locator('.list-row:has-text("테스트 텐트")').count() === 0);
  check('계정을 바꾼 뒤에도 B 공간 경로만 접근', (await foreignAccess(A, UB.uid)).length === 0, await foreignAccess(A, UB.uid));
  await nav(A, 'home');
  check('계정을 바꾸면 위젯 설정도 그 계정 것(B: 기준 지역 위젯 켜짐)', await A.locator('.weather-widget').count() === 1);

  // ================= 9. APK(네이티브 로그인) 경로 =================
  const N = await newPhone({ mobile: true, native: UN });
  await waitLoginReady(N);
  check('APK: initializeAuth + IndexedDB 로그인 유지(팝업 도우미 없음)', await N.evaluate(() => JSON.stringify(window.__fakeAuthInit)) === JSON.stringify({ kind: 'initializeAuth', persistence: ['indexedDB', 'local'] }), await N.evaluate(() => window.__fakeAuthInit));
  await login(N);
  const nCalls = await N.evaluate(() => ({ native: window.__nativeCalls, cred: window.__fakeCredentialCalls, popup: window.__fakePopupCalls }));
  check('APK: 네이티브 구글 로그인 → idToken으로 signInWithCredential', nCalls.native[0] === 'signInWithGoogle' && nCalls.cred.length === 1 && nCalls.cred[0].idToken === 'native-id-token-' + UN.uid && nCalls.cred[0].providerId === 'google.com' && nCalls.popup === 0, nCalls);
  check('APK: 로그인 후 내 공간(users/{uid})에 계정 정보 저장', server['users/' + UN.uid] && server['users/' + UN.uid].email === UN.email);
  await nav(N, 'settings');
  await N.click('[data-action="logout"]');
  await N.click('[data-action="confirm-yes"]');
  await N.waitForSelector('#login-screen', { state: 'visible', timeout: 3000 }).catch(() => {});
  check('APK: 로그아웃 시 네이티브 로그아웃도 호출', (await N.evaluate(() => window.__nativeCalls)).includes('signOut') && await loginVisible(N));

  // ================= 10. 미리보기 모드 (설정값 없음) =================
  const P = await newPhone({ noFake: true, url: 'http://127.0.0.1:8766/' });
  await waitStatus(P, /로컬 미리보기/);
  check('설정값 없으면 로그인 없이 미리보기 모드 + 배너', !(await loginVisible(P)) && (await P.locator('.preview-banner').count()) === 1);
  await nav(P, 'camping');
  check('미리보기 모드는 예시 데이터로 채움', await P.locator('.list-row:has-text("홍천 강변 캠핑장")').count() === 1);
  await nav(P, 'settings');
  check('미리보기 모드 Settings에는 계정/가져오기 없음', (await P.locator('[data-action="logout"]').count()) === 0 && (await P.locator('[data-action="legacy-import"]').count()) === 0);

  // ================= 11. SDK를 못 불러옴 (웹 오프라인 첫 실행) =================
  const E = await newPhone({ noFake: true, brokenSdk: true });
  await waitStatus(E, /연결 안 됨/, 8000).catch(() => {});
  check('SDK를 못 불러오면 연결 안 됨 + 배너', /연결 안 됨/.test(await status(E)) && (await E.locator('.preview-banner').count()) === 1, await status(E));
  await nav(E, 'camping');
  check('연결 실패 시 예시 데이터를 섞지 않음', await E.locator('.list-row:has-text("홍천 강변 캠핑장")').count() === 0);

  const pageErrors = pages.flatMap(p => p.__errors);
  const unexpected = pageErrors.filter(m => !/offline: SDK unavailable/.test(m));
  check('페이지 오류·네이티브 대화상자 없음', unexpected.length === 0, unexpected);

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
  await browser.close(); srv1.kill(); srv2.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
