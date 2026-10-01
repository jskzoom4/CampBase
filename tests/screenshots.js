// 화면 스크린샷(디자인 확인용, 자동 테스트 아님): 390px·1280px × 밝은/어두운 모드로 주요 화면 5개.
// 실행: node tests/screenshots.js <출력폴더> [docs 폴더(기본: docs)]
//   Home / Camping(내 기록·그룹 후기) / Gear(선택 모드가 있으면 선택 모드) / Checklist(전체·그룹 일정 패널·스크롤 상태) / Cooking / 모달(그룹 일정 만들기)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OUT = path.resolve(process.argv[2] || 'screenshots');
const DOCS = path.resolve(process.argv[3] || path.join(__dirname, '..', 'docs'));
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-shots-'));
fs.cpSync(DOCS, SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8779;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
function seed() {
  const s = {}, A = 'users/uidAlice/', G = 'groups/grpFam';
  const mem = (n, r) => ({ name: n, photoURL: '', role: r });
  s[A + 'campingLogs/c1'] = { name: '홍천 강변 캠핑장', date: '2026-08-16', region: '홍천', siteType: '데크', siteSize: '5x5m', rating: 4, checkinTime: '14:00', checkoutTime: '11:00', toiletCondition: '좋음', storeCondition: '적당함', notes: '계곡 바로 옆이라 시원했어요.', sharedGroupIds: ['grpFam'] };
  s[A + 'campingLogs/c2'] = { name: '가평 숲속 야영장', date: '2026-05-02', region: '가평', siteType: '흙', siteSize: '6x6m', rating: 5, toiletCondition: '보통', storeCondition: '없음', notes: '' };
  s[A + 'gear/g1'] = { name: '스텔스 5 텐트', brand: 'Snow Peak', category: '텐트', price: 520000, weight: 8.2, date: '2024-04-12' };
  s[A + 'gear/g2'] = { name: '체어 원', brand: 'Helinox', category: '체어/테이블', price: 139000, weight: 0.9, date: '2024-05-20' };
  s[A + 'gear/g3'] = { name: '부스터 플러스1', brand: 'Kovea', category: '조리용품', price: 78000, weight: 0.4, date: '2023-09-02' };
  s[A + 'checklists/cl1'] = { title: '기본 캠핑 준비물', items: [
    { id: 'i1', label: '텐트', status: 'packed', group: '텐트/침구' }, { id: 'i2', label: '침낭', status: 'pending', group: '텐트/침구' },
    { id: 'i3', label: '랜턴', status: 'skip', group: '조명/전기' } ] };
  s[A + 'trips/t1'] = { title: '홍천 가을 캠핑', startDate: ymd(6), endDate: ymd(7), campsiteName: '홍천 강변 캠핑장', region: '홍천', createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  s[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob', 'uidCarol'], createdAt: '1', gearCategories: ['텐트', '타프', '조리용품', '기타'],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member'), uidCarol: mem('캐롤', 'member') } };
  s[G + '/trips/gt'] = { title: '10월 팸 캠핑', startDate: ymd(3), endDate: ymd(4), campsiteName: '가평 숲속 야영장', region: '가평', memberUids: ['uidAlice', 'uidBob', 'uidCarol'], createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  s[G + '/checklists/gl'] = { title: '팸 캠핑 준비물', tripId: 'gt', addedBy: 'uidAlice', items: [
    { id: 'a1', label: '스텔스 5 텐트', status: 'packed', group: '텐트', assigneeUid: 'uidBob' },
    { id: 'a2', label: '렉타 타프', status: 'pending', group: '타프', assigneeUid: 'uidAlice' },
    { id: 'a3', label: '버너', status: 'pending', group: '조리', assigneeUid: 'uidCarol' },
    { id: 'a4', label: '아이스박스', status: 'skip', group: '조리' },
    { id: 'a5', label: '랜턴', status: 'pending', group: '조명' }, { id: 'a6', label: '랜턴 배터리', status: 'pending', group: '조명' },
    { id: 'a7', label: '침낭', status: 'packed', group: '침구' }, { id: 'a8', label: '매트', status: 'pending', group: '침구' },
    { id: 'a9', label: '코펠', status: 'pending', group: '조리', assigneeUid: 'uidAlice' } ] };
  s[G + '/gear/gg1'] = { name: '렉타 타프', brand: 'DOD', category: '타프', ownerUid: 'uidBob', addedBy: 'uidBob' };
  const rv = (uid, id, o) => ({ authorUid: uid, sourceLogId: id, updatedAt: 'x', siteType: '데크', ...o });
  s[G + '/sharedReviews/uidAlice_c1'] = rv('uidAlice', 'c1', { name: '홍천 강변 캠핑장', date: '2026-08-16', region: '홍천', rating: 4, toiletCondition: '좋음', storeCondition: '적당함', notes: '계곡 옆' });
  s[G + '/sharedReviews/uidBob_b1'] = rv('uidBob', 'b1', { name: '홍천강변캠핑장', date: '2026-09-20', region: '홍천', rating: 5, toiletCondition: '좋음', storeCondition: '없음', notes: '사람 많음' });
  s[G + '/sharedReviews/uidCarol_x'] = rv('uidCarol', 'x', { name: '양양 바다 캠핑장', date: '2026-07-01', region: '양양', rating: 3, toiletCondition: '보통', storeCondition: '적당함' });
  return s;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  for (const [w, h, vp] of [[390, 844, 'm390'], [1280, 860, 'd1280']]) {
    for (const scheme of ['light', 'dark']) {
      const server = seed();
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
      await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
      await ctx.exposeFunction('__fsDump', () => JSON.parse(JSON.stringify(server)));
      await ctx.exposeFunction('__fsWrite', async (p, d) => { if (d === null) delete server[p]; else server[p] = d; });
      await ctx.addInitScript(u => { window.__fakePopupUser = u; }, UA);
      await ctx.addInitScript(FAKE);
      const p = await ctx.newPage();
      await p.goto(`http://127.0.0.1:${PORT}/`);
      await p.waitForSelector('#login-btn:not([disabled])');
      await p.click('[data-action="login-google"]');
      await p.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent));
      const nav = async tab => { await p.locator(`[data-nav="${tab}"]:visible`).first().click(); await sleep(400); };
      const shot = async name => { await sleep(250); await p.screenshot({ path: path.join(OUT, `${vp}-${scheme}-${name}.png`) }); };
      const tryClick = async sel => { const l = p.locator(sel).first(); if (await l.count() && await l.isVisible()) { await l.click(); await sleep(250); return true; } return false; };
      await nav('home'); await shot('1-home');
      await nav('camping'); await tryClick('.camp-view-chip:has-text("내 기록")'); await shot('2-camping-mine');
      await tryClick('.camp-view-chip:has-text("캠핑팸")'); await sleep(200); await shot('3-camping-group-reviews');
      await nav('gear'); await tryClick('.space-chip:has-text("내 공간")');
      if (await tryClick('[data-action="gear-select"]')) { await tryClick('[data-action="gear-pick"]'); await p.locator('[data-action="gear-pick"]').nth(1).click().catch(() => {}); await sleep(200); }
      await shot('4-gear');
      await nav('checklist'); await tryClick('.space-chip:has-text("내 공간")'); await tryClick('[data-action="trip-pick"][data-trip="all"]'); await shot('5-checklist-all');
      await tryClick('.space-chip:has-text("캠핑팸")'); await sleep(200);
      await tryClick('.trip-chip:has-text("10월 팸 캠핑")'); await shot('6-checklist-trip-panel');
      await p.evaluate(() => { const m = document.getElementById('main'); m.scrollTop = 420; }); await sleep(300); await shot('7-checklist-trip-scrolled');
      await p.evaluate(() => { document.getElementById('main').scrollTop = 0; });
      await nav('cooking'); await shot('8-cooking');
      await nav('checklist'); await tryClick('[data-action="trip-new"]'); await sleep(200); await shot('9-modal-trip-group');
      await ctx.close();
    }
  }
  await browser.close(); srv.kill();
  console.log('saved to', OUT);
})().catch(e => { console.error(e); process.exit(1); });
