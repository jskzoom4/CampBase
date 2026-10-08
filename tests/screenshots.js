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
  s[A + 'campingLogs/c1'] = { name: '홍천 강변 캠핑장', date: '2026-08-16', region: '홍천', siteType: '데크', siteSize: '5x5m', rating: 4, checkinTime: '14:00', checkoutTime: '11:00', toiletCondition: '좋음', storeCondition: '적당함', notes: '계곡 바로 옆이라 시원했어요. 데크가 넓어서 텐트와 타프를 다 쳐도 여유가 있었고, 밤에는 강바람 때문에 꽤 추워서 침낭을 두꺼운 걸로 챙기길 잘했어요. 샤워장은 온수가 잘 나왔고 매점에서 장작도 팔아요.', showerCondition: '좋음', sharedGroupIds: ['grpFam'] };
  s[A + 'campingLogs/c2'] = { name: '가평 숲속 야영장', date: '2026-05-02', region: '가평', siteType: '흙', siteSize: '6x6m', rating: 5, toiletCondition: '보통', storeCondition: '없음', notes: '' };
  s[A + 'settings/app'] = { gearCategories: ['텐트', '타프', '침낭', '매트', '체어/테이블', '조리용품', '조명'], homeWidgets: { nextTrip: true, camping: true, gear: true, checklist: true },
    gearCategoryMeta: { majors: [{ name: '쉘터', desc: '집 짓기 — 텐트·타프' }, { name: '잠자리', desc: '' }, { name: '키친', desc: '요리·식사 도구' }],
      subs: [{ name: '텐트', major: '쉘터', desc: '4인용 이상' }, { name: '타프', major: '쉘터', desc: '' }, { name: '침낭', major: '잠자리', desc: '' }, { name: '매트', major: '잠자리', desc: '' },
        { name: '체어/테이블', major: '키친', desc: '' }, { name: '조리용품', major: '키친', desc: '' }] } };
  s[A + 'checklistTemplates/tp1'] = { title: '여름 오토캠핑 기본', createdBy: 'uidAlice', items: [{ label: '텐트', group: '텐트' }, { label: '타프', group: '텐트' }, { label: '버너', group: '조리' }, { label: '코펠', group: '조리' }, { label: '랜턴', group: '조명' }] };
  s[A + 'gear/g1'] = { name: '스텔스 5 텐트', brand: 'Snow Peak', category: '텐트', price: 520000, weight: 8.2, date: '2024-04-12', comment: '폴대 하나 수리함. 우중 캠핑 땐 그라운드시트 같이' };
  s[A + 'gear/g2'] = { name: '체어 원', brand: 'Helinox', category: '체어/테이블', price: 139000, weight: 0.9, date: '2024-05-20' };
  s[A + 'gear/g3'] = { name: '부스터 플러스1', brand: 'Kovea', category: '조리용품', price: 78000, weight: 0.4, date: '2023-09-02', comment: '가스 카트리지 2개' };
  s[A + 'gear/g4'] = { name: '렉타 타프 L', brand: 'DOD', category: '타프' };
  s[A + 'gear/g5'] = { name: '오로라 침낭', brand: 'Nanga', category: '침낭', comment: '겨울용(-10도)' };
  s[A + 'gear/g6'] = { name: '자충 매트', brand: 'Therm-a-Rest', category: '매트' };
  s[A + 'gear/g7'] = { name: '레일로드 랜턴', brand: 'Barebones', category: '조명' };
  s[A + 'checklists/cl1'] = { title: '기본 캠핑 준비물', items: [
    { id: 'i1', label: '텐트', status: 'packed', group: '텐트/침구' }, { id: 'i2', label: '침낭', status: 'pending', group: '텐트/침구' },
    { id: 'i3', label: '랜턴', status: 'skip', group: '조명/전기' } ] };
  s[A + 'trips/t1'] = { title: '홍천 가을 캠핑', startDate: ymd(6), endDate: ymd(7), campsiteName: '홍천 강변 캠핑장', region: '홍천', description: '사이트 A-12 (강 바로 앞)\n장작은 현장 구매, 금요일 6시 출발', createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  s[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob', 'uidCarol'], createdAt: '1', gearCategories: ['텐트', '타프', '조리용품', '기타'],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member'), uidCarol: mem('캐롤', 'member') } };
  s[G + '/trips/gt'] = { title: '10월 팸 캠핑', startDate: ymd(3), endDate: ymd(4), campsiteName: '가평 숲속 야영장', region: '가평', memberUids: ['uidAlice', 'uidBob', 'uidCarol'], createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice',
    mealServings: 4, meals: [
      { id: 'm1_lunch', day: 1, slot: 'lunch', dishes: [{ id: 'd1', name: '김밥' }] },
      { id: 'm1_dinner', day: 1, slot: 'dinner', dishes: [{ id: 'd2', recipeId: 'ck1', name: '삼겹살 구이', assigneeUid: 'uidBob' }, { id: 'd3', recipeId: 'ck10', name: '김치찌개' }] },
      { id: 'm2_breakfast', day: 2, slot: 'breakfast', servings: 3, dishes: [{ id: 'd4', recipeId: 'ck8', name: '짜파구리' }] },
      { id: 'mx', day: 1, slot: 'extra', label: '야식', dishes: [{ id: 'd5', recipeId: 'ck15', name: '마시멜로 스모어' }] } ] };
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
  s[G + '/sharedReviews/uidBob_b1'] = rv('uidBob', 'b1', { name: '홍천강변캠핑장', date: '2026-09-20', region: '홍천', rating: 5, toiletCondition: '좋음', showerCondition: '보통', storeCondition: '없음', notes: '사람 많음', updatedBy: 'uidCarol' });
  s[A + 'trips/tp'] = { title: '여름 춘천 캠핑', startDate: ymd(-40), endDate: ymd(-38), campsiteName: '춘천 호수 캠핑장', region: '춘천', createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  s[A + 'checklists/clp'] = { title: '춘천 준비물', tripId: 'tp', items: [{ id: 'p1', label: '텐트', status: 'packed', group: '텐트' }, { id: 'p2', label: '버너', status: 'skip', group: '조리' }] };
  s[G + '/sharedReviews/uidCarol_x'] = rv('uidCarol', 'x', { name: '양양 바다 캠핑장', date: '2026-07-01', region: '양양', rating: 3, toiletCondition: '보통', storeCondition: '적당함' });
  return s;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });   // 실패로 끝나도 서버를 남기지 않음(남으면 다음 실행이 예전 코드를 받음)
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
      await tryClick('.list-row:has-text("홍천 강변") .camp-line3'); await shot('2b-camping-mine-expanded');
      await tryClick('[data-action="camp-new"]'); await sleep(200); await shot('2c-modal-camp-form');
      await p.evaluate(() => { const b = document.querySelector('.modal-body'); if (b) b.scrollTop = 400; }); await shot('2d-modal-camp-form-scrolled');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await tryClick('.camp-view-chip:has-text("캠핑팸")'); await sleep(200); await shot('3-camping-group-reviews');
      await tryClick('.review-card:has-text("홍천")'); await sleep(200); await shot('3b-modal-review-detail');
      await tryClick('.review-row:has-text("밥") [data-action="review-edit"]'); await sleep(300); await shot('3c-modal-review-edit');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await tryClick('[data-action="camp-new-group"]'); await sleep(200); await shot('3d-modal-group-add');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await nav('gear'); await tryClick('.space-chip:has-text("내 공간")');
      await shot('4-gear');
      if (await tryClick('[data-action="gear-select"]')) { await tryClick('.gear-sec-top [data-action="gear-pick-many"]'); await tryClick('[data-action="gear-pick"]'); }
      await shot('15-gear-select'); await tryClick('[data-action="gear-select-cancel"]');
      await nav('checklist'); await tryClick('.space-chip:has-text("내 공간")'); await tryClick('[data-action="trip-pick"][data-trip="all"]'); await shot('5-checklist-all');
      await tryClick('.space-chip:has-text("캠핑팸")'); await sleep(200);
      await tryClick('.trip-chip:has-text("10월 팸 캠핑")'); await shot('6-checklist-trip-panel');
      await p.evaluate(() => { const m = document.getElementById('main'); m.scrollTop = 420; }); await sleep(300); await shot('7-checklist-trip-scrolled');
      await p.evaluate(() => { document.getElementById('main').scrollTop = 0; });
      await nav('cooking'); await shot('8-cooking');
      await tryClick('.cook-trip-chip:has-text("홍천 가을 캠핑")'); await shot('23-cooking-plan-empty');
      await tryClick('.cook-trip-chip:has-text("10월 팸 캠핑")'); await shot('21-cooking-plan-filled');
      await tryClick('.dish-btn:has-text("김치찌개")'); await shot('21b-cooking-plan-recipe-open');
      await tryClick('.meal-row[data-meal-row="m2_lunch"] [data-action="meal-add-dish"]'); await sleep(200);
      await p.fill('#mp-custom', '부대찌개').catch(() => {}); await p.fill('#mp-ings', '햄 200g, 라면사리 2개, 김치').catch(() => {}); await shot('22-modal-meal-picker');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await tryClick('[data-action="shop-create"]'); await sleep(300);
      await tryClick('[data-action="shop-open"]'); await sleep(600); await shot('25-checklist-shopping');
      await nav('checklist'); await tryClick('[data-action="trip-new"]'); await sleep(200); await shot('9-modal-trip-group');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await nav('gear'); await tryClick('.space-chip:has-text("내 공간")');
      await tryClick('.gear-head-actions .more-btn'); await tryClick('[data-action="gear-cat-manage"]'); await sleep(200); await shot('10-modal-gear-categories');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await tryClick('[data-action="gear-new"]'); await sleep(200); await shot('11-modal-gear-form');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await nav('checklist'); await tryClick('.space-chip:has-text("내 공간")'); await tryClick('.trip-chip:has-text("홍천 가을 캠핑")'); await sleep(200);
      await shot('12-checklist-trip-memo');
      if (await tryClick('[data-action="trip-gear-import"]')) { await sleep(200); await tryClick('.gpk-sec-row input'); await sleep(150); }
      await shot('13-modal-gear-pick');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await tryClick('.trip-panel .more-btn'); await tryClick('[data-action="trip-edit"]'); await sleep(200); await shot('14-modal-trip-edit');
      await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250);
      await tryClick('.sub-tab[data-view="pastTrips"]:visible, #nav [data-nav="pastTrips"]:visible'); await sleep(200); await shot('19-checklist-past-trips');
      await tryClick('.past-trip-card'); await sleep(200); await shot('20-checklist-past-trip-panel');
      await tryClick('.sub-tab[data-view="templates"]:visible, #nav [data-nav="templates"]:visible'); await sleep(200); await shot('16-checklist-templates');
      if (await tryClick('[data-action="tpl-new"]')) { await p.fill('#tpl-title', '오토캠핑 기본').catch(() => {}); await tryClick('[data-action="tpl-save"]'); await sleep(250); await tryClick('#modal-root #gpk-all'); }
      await shot('18-modal-template-gear'); await tryClick('#modal-root [data-action="modal-close"]'); await sleep(250); await nav('checklist');
      await tryClick('[data-action="trip-pick"][data-trip="all"]'); await tryClick('[data-action="cl-new-list"]'); await sleep(200);
      await p.selectOption('#ncl-tpl', 'tp1').catch(() => {}); await sleep(100); await shot('17-modal-new-list');
      await ctx.close();
    }
  }
  await browser.close(); srv.kill();
  console.log('saved to', OUT);
})().catch(e => { console.error(e); process.exit(1); });
