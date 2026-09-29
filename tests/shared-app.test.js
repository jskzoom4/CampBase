// 공유 앱(docs/index.html) 전체 동작 테스트.
// 실제 Firebase 대신 같은 API를 흉내 낸 가짜 Firestore(tests/fake-firestore.js)를 쓰고,
// 데이터는 이 테스트 러너가 보관한다 → 브라우저 컨텍스트 여러 개 = 친구 여러 명의 폰.
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

const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const srv1 = spawn('python3', ['-m', 'http.server', '8765', '-d', CONFIGURED], { stdio: 'ignore' });
  const srv2 = spawn('python3', ['-m', 'http.server', '8766', '-d', UNCONFIGURED], { stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});

  // ---- the shared "server" ----
  const server = {};
  const pages = [];
  async function newPhone(opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1300, height: 950 } });
    await ctx.exposeFunction('__fsDump', () => JSON.parse(JSON.stringify(server)));
    await ctx.exposeFunction('__fsWrite', async (p, d) => {
      if (d === null) delete server[p]; else server[p] = d;
      for (const pg of pages) { if (!pg.isClosed()) pg.evaluate(([p2, d2]) => window.__fsApply && window.__fsApply(p2, d2), [p, d]).catch(() => {}); }
    });
    if (!opts.noFake) await ctx.addInitScript(FAKE);
    // SDK를 못 불러오는 상황(오프라인 첫 실행)을 네트워크와 무관하게 재현
    if (opts.brokenSdk) await ctx.addInitScript(() => { window.__FIREBASE_MODULES__ = { app: { getApps: () => [], initializeApp() { throw new Error('offline: SDK unavailable'); } }, firestore: {} }; });
    if (opts.denied) await ctx.addInitScript(() => { window.__fakeDeniedInit = true; });
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

  // ================= A. two phones sharing one Firestore =================
  const A = await newPhone();
  const B = await newPhone({ mobile: true });
  await waitStatus(A, /자동 저장 켜짐/); await waitStatus(B, /자동 저장 켜짐/);
  check('A: 공유 저장소 연결 상태 표시', /함께 쓰는 중/.test(await status(A)), await status(A));
  check('B(모바일): 상단 상태 표시 보임', await B.locator('#db-status-top').isVisible() && /함께 쓰는 중/.test(await statusTop(B)));
  check('Firestore 오프라인 캐시 설정 사용', await A.evaluate(() => window.__fsSettings && window.__fsSettings.localCache && window.__fsSettings.localCache.kind === 'persistent'));
  await sleep(300);
  check('빈 저장소에 예시 데이터를 자동으로 쓰지 않음', Object.keys(server).length === 0, Object.keys(server));
  check('공유 모드에서는 미리보기 배너 없음', (await A.locator('.preview-banner').count()) === 0);

  // A creates a checklist + item
  await A.locator('[data-nav=\"checklist\"]:visible').first().click();
  await A.click('[data-action="cl-new-list"]');
  await A.fill('#ncl-title', '공유테스트');
  await A.click('[data-action="cl-new-list-save"]');
  await A.click('.checklist-group:has-text("공유테스트") [data-action="cl-add-item"]');
  await A.fill('#cli-label', '랜턴'); await A.fill('#cli-group', '조명');
  await A.click('[data-action="cl-add-item-save"]');
  await sleep(400);
  await B.locator('[data-nav=\"checklist\"]:visible').first().click();
  await B.waitForSelector('.checklist-group:has-text("공유테스트") .check-row:has-text("랜턴")', { timeout: 3000 }).catch(() => {});
  check('A가 만든 리스트·항목이 B 화면에 나타남', await B.locator('.checklist-group:has-text("공유테스트") .check-row:has-text("랜턴")').count() === 1);

  // B checks it as packed -> A sees it live (A stays on the checklist tab)
  await B.click('.check-row:has-text("랜턴") [data-action="cl-item-status"][data-val="packed"]');
  await A.waitForSelector('.check-row:has-text("랜턴") .cl-status-btn.packed.active', { timeout: 3000 }).catch(() => {});
  check('B가 체크한 내용이 A 화면에 실시간 반영', await A.locator('.check-row:has-text("랜턴") .cl-status-btn.packed.active').count() === 1);
  check('A 화면 대분류에 완료 배지', await A.locator('.checklist-group:has-text("공유테스트") .done-tag').count() === 1);

  // A renames the list -> B sees new title
  await A.click('.checklist-group:has-text("공유테스트") [data-action="cl-list-rename"]');
  await A.fill('#cl-title-name', '공유테스트-이름변경');
  await A.click('[data-action="cl-list-rename-save"]');
  await B.waitForSelector('.checklist-group h3:has-text("공유테스트-이름변경")', { timeout: 3000 }).catch(() => {});
  check('리스트 이름 변경도 B에 반영', await B.locator('.checklist-group h3:has-text("공유테스트-이름변경")').count() === 1);

  // Home widget toggle is per-device
  await A.locator('[data-nav=\"settings\"]:visible').first().click();
  await A.locator('label.switch').first().click();
  await sleep(300);
  await B.locator('[data-nav=\"home\"]:visible').first().click();
  await A.locator('[data-nav=\"home\"]:visible').first().click();
  const aLoc = await A.locator('.weather-widget').count(), bLoc = await B.locator('.weather-widget').count();
  check('Home 위젯 끄기는 그 기기에만 적용 (A 꺼짐, B 그대로)', aLoc === 0 && bLoc === 1, { aLoc, bLoc });
  check('위젯 설정은 공유 저장소에 저장하지 않음', !server['app/settings'] || !('homeWidgets' in server['app/settings']), server['app/settings']);
  await A.reload(); await waitStatus(A, /자동 저장/);
  check('A 위젯 설정이 새로고침 후에도 유지 (기기 저장)', await A.locator('.weather-widget').count() === 0);

  // Export
  await A.locator('[data-nav=\"settings\"]:visible').first().click();
  await A.click('[data-action="backup-export"]');
  const exported = await A.inputValue('#backup-text');
  let exp = null; try { exp = JSON.parse(exported); } catch (e) {}
  check('백업 내보내기: 올바른 JSON + 리스트 포함', exp && exp.app === 'campbase' && exp.checklists.some(c => c.title === '공유테스트-이름변경'));
  await A.click('[data-action="modal-close"]');

  // Import the migrated claude.ai backup from a file
  await A.click('[data-action="backup-import"]');
  await A.setInputFiles('#backup-file', BACKUP);
  await A.waitForFunction(() => (document.getElementById('backup-text-in') || {}).value.length > 50, null, { timeout: 3000 });
  await A.click('[data-action="backup-import-go"]');
  const confirmText = await A.locator('#modal-root').innerText();
  check('가져오기 전 확인 모달에 개수 표시', /캠핑 기록 2개, 장비 3개, 체크리스트 1개/.test(confirmText), confirmText.slice(0, 80));
  await A.click('[data-action="confirm-yes"]');
  await sleep(800);
  await B.locator('[data-nav=\"checklist\"]:visible').first().click();
  await B.waitForSelector('.checklist-group h3:has-text("10/4-5")', { timeout: 3000 }).catch(() => {});
  check('가져온 체크리스트(10/4-5)가 B에 보임', await B.locator('.checklist-group h3:has-text("10/4-5")').count() === 1);
  check('가져오기 전 리스트는 교체되어 사라짐', await B.locator('.checklist-group h3:has-text("공유테스트")').count() === 0);
  await B.locator('[data-nav=\"camping\"]:visible').first().click();
  check('가져온 캠핑 기록 2개가 B에 보임', await B.locator('.list-row .name').count() === 2);
  await B.locator('[data-nav=\"gear\"]:visible').first().click();
  check('가져온 장비 3개가 B에 보임', await B.locator('.list-row').count() === 3);
  const keys = Object.keys(server).sort();
  check('공유 저장소 내용이 백업과 일치', keys.filter(k => k.startsWith('campingLogs/')).length === 2 && keys.filter(k => k.startsWith('gear/')).length === 3 && keys.filter(k => k.startsWith('checklists/')).length === 1, keys);
  check('가져온 기기(A)에 백업의 위젯 설정 적용', await A.evaluate(() => JSON.parse(localStorage.getItem('campbase.homeWidgets') || '{}').camping === false));

  // Broken paste is rejected safely
  await A.locator('[data-nav=\"settings\"]:visible').first().click();
  await A.click('[data-action="backup-import"]');
  await A.fill('#backup-text-in', '{"hello":1}');
  await A.click('[data-action="backup-import-go"]');
  await sleep(200);
  check('캠프베이스 백업이 아니면 거부', /백업 파일이 아니에요/.test(await A.locator('#toast').innerText()) && (await A.locator('[data-action="confirm-yes"]').count()) === 0);
  await A.click('[data-action="modal-close"]');

  // Offline indicator
  await A.evaluate(() => { window.__fakeOffline = true; window.__fakeEmitAll(); });
  await sleep(3500);
  check('오프라인 3초 이상이면 오프라인 표시', /오프라인/.test(await status(A)), await status(A));
  await A.evaluate(() => { window.__fakeOffline = false; window.__fakeEmitAll(); });
  await sleep(200);
  check('연결되면 다시 함께 쓰는 중 표시', /함께 쓰는 중/.test(await status(A)), await status(A));

  // Permission denied (rules not published)
  const C = await newPhone({ denied: true });
  await C.waitForFunction(() => /규칙/.test(document.getElementById('toast').textContent), null, { timeout: 6000 }).catch(() => {});
  check('규칙 미게시(권한 거부) 시 안내 토스트', /Firestore 규칙/.test(await C.locator('#toast').innerText()), await C.locator('#toast').innerText());

  // ================= B. preview mode (config not filled) =================
  const P = await newPhone({ noFake: true, url: 'http://127.0.0.1:8766/' });
  await waitStatus(P, /로컬 미리보기/);
  check('설정값 없으면 미리보기 모드 + 배너', (await P.locator('.preview-banner').count()) === 1);
  await P.locator('[data-nav=\"camping\"]:visible').first().click();
  check('미리보기 모드는 예시 데이터로 채움', await P.locator('.list-row:has-text("홍천 강변 캠핑장")').count() === 1);

  // ================= C. SDK cannot load (offline first launch on web) =================
  const E = await newPhone({ noFake: true, brokenSdk: true });
  await waitStatus(E, /연결 안 됨/, 8000).catch(() => {});
  check('SDK를 못 불러오면 연결 안 됨 + 배너', /연결 안 됨/.test(await status(E)) && (await E.locator('.preview-banner').count()) === 1, await status(E));
  await E.locator('[data-nav=\"camping\"]:visible').first().click();
  check('연결 실패 시 예시 데이터를 섞지 않음', await E.locator('.list-row:has-text("홍천 강변 캠핑장")').count() === 0);

  const pageErrors = pages.flatMap(p => p.__errors);
  const unexpected = pageErrors.filter(m => !/offline: SDK unavailable/.test(m));
  check('페이지 오류·네이티브 대화상자 없음', unexpected.length === 0, unexpected);

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
  await browser.close(); srv1.kill(); srv2.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
