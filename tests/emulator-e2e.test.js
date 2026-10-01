// 진짜 Firebase SDK(10.12.2) + Firebase 에뮬레이터(Auth·Firestore, firestore.rules 적용)로 앱을 끝까지 돌려보는 테스트.
// APK와 같은 방식(docs/vendor/firebase/ + 네이티브 구글 로그인 → idToken → signInWithCredential)으로 연다.
// 네이티브 플러그인만 흉내 내고, idToken은 Auth 에뮬레이터가 받아주는 가짜 토큰을 쓴다.
// 실행(저장소 루트에서, Java 11 이상 필요):
//   npm i --no-save playwright firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10.12.2
//   npx firebase emulators:exec --only firestore,auth --project demo-campbase "node tests/emulator-e2e.test.js"
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, collection, getDocs, query, where, setLogLevel } = require('firebase/firestore');
setLogLevel('silent');

const ROOT = path.join(__dirname, '..');
const PROJECT = 'demo-campbase';
const [FS_HOST, FS_PORT] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const AUTH_PORT = Number((process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099').split(':')[1]);
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

// docs/ 복사 + 워크플로와 같은 방식으로 SDK를 vendor/에 넣음(npm의 firebase 패키지 = gstatic CDN과 같은 파일)
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-e2e-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), `window.FIREBASE_CONFIG = { apiKey: "fake-api-key", authDomain: "${PROJECT}.firebaseapp.com", projectId: "${PROJECT}", appId: "1:1:web:1" };\n`);
const V = fs.readFileSync(path.join(ROOT, 'docs', 'index.html'), 'utf8').match(/FIREBASE_SDK_VERSION = '([\d.]+)'/)[1];
fs.mkdirSync(path.join(SITE, 'vendor', 'firebase'), { recursive: true });
for (const m of ['app', 'firestore', 'auth']) {
  const src = require.resolve('firebase/package.json').replace('package.json', `firebase-${m}.js`);
  const js = fs.readFileSync(src, 'utf8').split(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`).join('./firebase-app.js');
  fs.writeFileSync(path.join(SITE, 'vendor', 'firebase', `firebase-${m}.js`), js);
}

const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, t = 8000) => { const end = Date.now() + t; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(150); } return null; };

(async () => {
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: FS_HOST, port: Number(FS_PORT), rules: fs.readFileSync(path.join(ROOT, 'firestore.rules'), 'utf8') } });
  await env.clearFirestore();
  await fetch(`http://${FS_HOST}:${AUTH_PORT}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' }).catch(() => {});
  // 예전 APK가 쓰던 최상위 공유 데이터
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'campingLogs/legacyCamp'), { name: '예전 공유 캠핑장', region: '양양' });
    await setDoc(doc(db, 'gear/legacyGear'), { name: '예전 공유 해먹', category: '해먹' });
    await setDoc(doc(db, 'app/settings'), { gearCategories: ['텐트', '해먹', '기타'] });
  });
  const admin = async fn => { let out; await env.withSecurityRulesDisabled(async ctx => { out = await fn(ctx.firestore()); }); return out; };

  const srv = spawn('python3', ['-m', 'http.server', '8768', '-d', SITE], { stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const errors = [];
  async function phone(person) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
    await ctx.addInitScript(([emu, person]) => {
      window.__FIREBASE_EMULATOR__ = emu;
      // APK 흉내: 네이티브 구글 로그인 플러그인. Auth 에뮬레이터는 서명 없는 JSON idToken을 받아줌.
      const idToken = JSON.stringify({ sub: person.sub, email: person.email, email_verified: true, name: person.name });
      window.__nativeCalls = [];
      window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: { FirebaseAuthentication: {
        signInWithGoogle: async () => { window.__nativeCalls.push('signInWithGoogle'); return { credential: { providerId: 'google.com', idToken } }; },
        signOut: async () => { window.__nativeCalls.push('signOut'); },
      } } };
    }, [{ host: '127.0.0.1', firestorePort: Number(FS_PORT), authPort: AUTH_PORT }, person]);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(person.name + ': ' + e.message));
    page.on('dialog', d => { errors.push('NATIVE DIALOG'); d.dismiss(); });
    await page.goto('http://127.0.0.1:8768/');
    return page;
  }
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const status = p => p.locator('#db-status-top').innerText();
  async function login(p) {
    await p.waitForSelector('#login-btn:not([disabled])', { timeout: 15000 });
    await p.click('[data-action="login-google"]');
    await p.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status-top').textContent), null, { timeout: 15000 });
    return p.evaluate(() => state.user.uid);
  }

  const A = await phone({ sub: 'google-alice', email: 'alice@example.com', name: 'Alice' });
  await A.waitForSelector('#login-btn:not([disabled])', { timeout: 15000 });
  check('실제 SDK: 로그인 전 로그인 화면', await A.locator('#login-screen').isVisible());
  const aUid = await login(A);
  check('실제 SDK: 네이티브 idToken → signInWithCredential 로그인 성공', !!aUid && (await A.evaluate(() => window.__nativeCalls)).includes('signInWithGoogle'), aUid);
  const prof = await until(() => admin(async db => { const s = await getDoc(doc(db, 'users/' + aUid)); return s.exists() && s.data(); }));
  check('실제 규칙: users/{uid} 계정 문서 저장됨', prof && prof.email === 'alice@example.com' && prof.name === 'Alice' && !!prof.updatedAt, prof);

  await nav(A, 'gear');
  await A.click('[data-action="gear-new"]');
  await A.fill('#gf-name', '앨리스 텐트');
  await A.click('[data-action="gear-save"]');
  const aGear = await until(() => admin(async db => { const s = await getDocs(collection(db, `users/${aUid}/gear`)); return s.size === 1 && s.docs[0].data(); }));
  check('실제 규칙: 장비가 users/{uid}/gear에 저장됨', aGear && aGear.name === '앨리스 텐트', aGear);
  await nav(A, 'settings');
  await A.locator('label.switch').first().click();
  const aSet = await until(() => admin(async db => { const s = await getDoc(doc(db, `users/${aUid}/settings/app`)); return s.exists() && s.data(); }));
  check('실제 규칙: Home 위젯 설정이 users/{uid}/settings/app에 저장', aSet && aSet.homeWidgets && aSet.homeWidgets.nextTrip === false, aSet);

  // 새로고침 → 로그인 유지(IndexedDB)
  await A.reload();
  await A.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status-top').textContent), null, { timeout: 15000 }).catch(() => {});
  check('실제 SDK: 새로고침해도 로그인 유지', !(await A.locator('#login-screen').isVisible()) && /자동 저장 켜짐/.test(await status(A)));

  const B = await phone({ sub: 'google-bob', email: 'bob@example.com', name: 'Bob' });
  const bUid = await login(B);
  await nav(B, 'gear');
  await sleep(800);
  check('실제 규칙: B에게는 A의 장비가 안 보임', bUid !== aUid && (await B.locator('.list-row:has-text("앨리스 텐트")').count()) === 0);
  check('B 화면에 권한 오류 토스트 없음', !/거부/.test(await B.locator('#toast').innerText()));

  // 기존 공유 데이터 가져오기
  await nav(B, 'settings');
  await B.click('[data-action="legacy-import"]');
  await B.waitForSelector('[data-action="confirm-yes"]', { timeout: 8000 }).catch(() => {});
  const confirmText = await B.locator('#modal-root').innerText();
  check('실제 SDK: legacy 개수 확인 모달', /캠핑 기록 1개, 장비 1개, 체크리스트 0개, 요리 재료 체크 0개/.test(confirmText), confirmText.slice(0, 100));
  await B.click('[data-action="confirm-yes"]');
  const bCopied = await until(() => admin(async db => {
    const c = await getDocs(collection(db, `users/${bUid}/campingLogs`));
    const g = await getDocs(collection(db, `users/${bUid}/gear`));
    return c.docs.some(d => d.id === 'legacyCamp') && g.docs.some(d => d.id === 'legacyGear') && { camp: c.size, gear: g.size };
  }));
  check('실제 규칙: legacy 데이터가 B의 개인 공간으로 복사됨', !!bCopied, bCopied);
  const legacyStill = await admin(async db => (await getDoc(doc(db, 'gear/legacyGear'))).exists());
  check('원본 legacy 데이터는 그대로', legacyStill);
  await nav(B, 'camping');
  await B.waitForSelector('.list-row:has-text("예전 공유 캠핑장")', { timeout: 5000 }).catch(() => {});
  check('가져온 기록이 B 화면에 보임', await B.locator('.list-row:has-text("예전 공유 캠핑장")').count() === 1);

  // 그룹: A 만들기 → 초대 코드 → B 참여 → 그룹 체크리스트 공유 → B 나가기 (진짜 SDK + 진짜 규칙)
  await nav(A, 'settings');
  await A.click('[data-action="group-new"]');
  await A.fill('#grp-name', '캠핑팸');
  await A.click('[data-action="group-new-save"]');
  const gid = await until(() => admin(async db => { const s = await getDocs(query(collection(db, 'groups'), where('ownerUid', '==', aUid))); return s.size === 1 && s.docs[0].id; }));
  check('실제 규칙: 그룹 만들기', !!gid, gid);
  await A.waitForSelector('.group-row [data-action="group-invite"]', { timeout: 8000 });
  await A.click('.group-row [data-action="group-invite"]');
  await A.waitForSelector('#invite-code', { timeout: 8000 }).catch(() => {});
  const code = (await A.locator('#invite-code').innerText().catch(() => '')).trim();
  check('실제 규칙: 초대 코드 만들기', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  await A.click('[data-action="modal-close"]').catch(() => {});
  await nav(B, 'settings');
  await B.click('[data-action="group-join"]');
  await B.fill('#join-code', code);
  await B.click('[data-action="group-join-check"]');
  await B.waitForSelector('[data-action="confirm-yes"]', { timeout: 8000 }).catch(() => {});
  await B.click('[data-action="confirm-yes"]').catch(() => {});
  const joined = await until(() => admin(async db => { const d = (await getDoc(doc(db, 'groups/' + gid))).data(); return d.memberUids.includes(bUid) && d; }));
  check('실제 규칙: 초대 코드로 참여(arrayUnion + members.uid)', joined && joined.members[bUid] && joined.members[bUid].role === 'member', joined && joined.memberUids);
  await nav(A, 'checklist');
  await A.locator('.space-chip:has-text("캠핑팸")').click();
  await A.click('[data-action="cl-new-list"]');
  await A.fill('#ncl-title', '그룹 준비물');
  await A.click('[data-action="cl-new-list-save"]');
  await nav(B, 'checklist');
  await B.waitForSelector('.space-chip:has-text("캠핑팸")', { timeout: 8000 }).catch(() => {});
  await B.locator('.space-chip:has-text("캠핑팸")').click().catch(() => {});
  await B.waitForSelector('.checklist-group:has-text("그룹 준비물")', { timeout: 8000 }).catch(() => {});
  check('실제 규칙: A의 그룹 리스트가 B에게 보임', (await B.locator('.checklist-group:has-text("그룹 준비물")').count()) === 1);
  await nav(B, 'settings');
  await B.click('.group-row [data-action="group-leave"]');
  await B.click('[data-action="confirm-yes"]');
  const left = await until(() => admin(async db => !(await getDoc(doc(db, 'groups/' + gid))).data().memberUids.includes(bUid)));
  check('실제 규칙: 나가기', !!left);
  check('그룹 작업 중 권한 오류 토스트 없음', !/권한|거부/.test(await A.locator('#toast').innerText()) && !/권한|거부/.test(await B.locator('#toast').innerText()));

  // 로그아웃
  await nav(B, 'settings');
  await B.click('[data-action="logout"]');
  await B.click('[data-action="confirm-yes"]');
  await B.waitForSelector('#login-screen', { state: 'visible', timeout: 8000 }).catch(() => {});
  check('실제 SDK: 로그아웃 → 로그인 화면 + 네이티브 로그아웃 호출', await B.locator('#login-screen').isVisible() && (await B.evaluate(() => window.__nativeCalls)).includes('signOut'));
  await B.reload();
  await B.waitForSelector('#login-btn:not([disabled])', { timeout: 15000 }).catch(() => {});
  check('실제 SDK: 로그아웃 상태 유지', await B.locator('#login-screen').isVisible());

  check('페이지 오류·네이티브 대화상자 없음', errors.length === 0, errors);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close(); srv.kill(); await env.cleanup();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
