// 그룹 후기 공유 테스트 (가짜 Firestore/Auth):
//  공유 켜기 → B 멤버에게 그룹 후기로 보임, 수정 시 사본 갱신, 공유 끄기·기록 삭제 시 사본 삭제, 되돌리기 시 사본 복구,
//  여러 그룹 공유, 캠핑장별 묶음·평균 평점·요약, 지역 필터·정렬, 그룹 일정 후기 남기기 시 기본 공유 켜짐,
//  그룹장 "그룹에서 내리기", 나간 멤버 표시·공유 정리, 비멤버에게는 안 보임, 백업 가져오기 후 사본 맞춤, 보기 기억.
// 실행: node tests/reviews.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-reviews-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8773;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const UC = { uid: 'uidCarol', displayName: '캐롤', email: 'carol@example.com', photoURL: '' };
const UD = { uid: 'uidDan', displayName: '댄', email: 'dan@example.com', photoURL: '' };

const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
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
  const put = async (p, d) => { if (d === null) delete server[p]; else server[p] = d; for (const pg of pages) await pg.evaluate(([p2, d2]) => window.__fsApply(p2, d2), [p, d]).catch(() => {}); };
  const settle = () => sleep(400);
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const toastText = p => p.locator('#toast').innerText();
  const confirmYes = async p => { await p.waitForSelector('[data-action="confirm-yes"]', { timeout: 3000 }); await p.click('[data-action="confirm-yes"]'); };
  const view = async (p, label) => { await p.locator(`.camp-view-chip:has-text("${label}")`).first().click(); await settle(); };
  const editLog = async (p, name) => { await p.click(`.list-row:has(.name:has-text("${name}")) [data-action="camp-edit"]`); await p.waitForSelector('#cf-name', { timeout: 3000 }); };
  const shareChip = (p, gname) => p.locator(`.share-chip:has-text("${gname}")`);
  const reviewKeys = gid => Object.keys(server).filter(k => k.startsWith(`groups/${gid}/sharedReviews/`)).sort();
  const A_ = 'users/' + UA.uid + '/', B_ = 'users/' + UB.uid + '/', C_ = 'users/' + UC.uid + '/';
  const G1 = 'grpFam', G2 = 'grpWork';
  const mem = (n, r) => ({ name: n, photoURL: '', role: r });

  // ---- 준비 ----
  server['groups/' + G1] = { name: '캠핑팸', ownerUid: UA.uid, memberUids: [UA.uid, UB.uid, UC.uid], createdAt: '1', gearCategories: ['기타'],
    members: { [UA.uid]: mem('앨리스', 'owner'), [UB.uid]: mem('밥', 'member'), [UC.uid]: mem('캐롤', 'member') } };
  server['groups/' + G2] = { name: '회사캠핑', ownerUid: UB.uid, memberUids: [UB.uid, UA.uid], createdAt: '2', gearCategories: ['기타'],
    members: { [UB.uid]: mem('밥', 'owner'), [UA.uid]: mem('앨리스', 'member') } };
  const full = { name: '홍천 강변 캠핑장', date: '2026-08-16', region: '홍천', siteType: '데크', siteSize: '5x5m', rating: 5, checkinTime: '14:00', checkoutTime: '11:00', toiletCondition: '좋음', storeCondition: '적당함', notes: '계곡 옆' };
  server[A_ + 'campingLogs/c1'] = { ...full };
  server[A_ + 'campingLogs/c2'] = { name: '가평 숲속 야영장', date: '2026-05-02', region: '가평', siteType: '흙', siteSize: '', rating: 4, checkinTime: '', checkoutTime: '', toiletCondition: '', storeCondition: '', notes: '' };
  server[B_ + 'campingLogs/b1'] = { name: '홍천강변캠핑장 ', date: '2026-09-20', region: '홍천', siteType: '파쇄석', siteSize: '6x6m', rating: 3, checkinTime: '13:00', checkoutTime: '12:00', toiletCondition: '좋음', storeCondition: '없음', notes: '사람 많음', sharedGroupIds: [G1] };
  server[B_ + 'campingLogs/b2'] = { name: '양양 바다 캠핑장', date: '2026-07-01', region: '양양', siteType: '데크', siteSize: '', rating: 2, checkinTime: '', checkoutTime: '', toiletCondition: '나쁨', storeCondition: '없음', notes: '', sharedGroupIds: [G1] };
  // B의 공유 사본(이미 올라가 있던 것)
  const bCopy = (id, log) => { const { sharedGroupIds, ...rest } = log; return { ...rest, authorUid: UB.uid, sourceLogId: id, updatedAt: 'x' }; };
  server[`groups/${G1}/sharedReviews/${UB.uid}_b1`] = bCopy('b1', server[B_ + 'campingLogs/b1']);
  server[`groups/${G1}/sharedReviews/${UB.uid}_b2`] = bCopy('b2', server[B_ + 'campingLogs/b2']);
  server[`groups/${G1}/trips/gt`] = { title: '팸 지난 캠핑', startDate: ymd(-5), endDate: ymd(-4), campsiteName: '가평 숲속 야영장', region: '가평', memberUids: [UA.uid, UB.uid], createdBy: UB.uid, createdAt: 'x', updatedBy: UB.uid };

  const A = await phone(UA);
  const B = await phone(UB, { mobile: true });

  // ================= 1. 공유 켜기 → B에게 그룹 후기로 =================
  await nav(A, 'camping');
  check('Camping 탭 위쪽 보기 전환 [내 기록 | 캠핑팸 후기 | 회사캠핑 후기]', (await A.locator('.camp-view-chip').allInnerTexts()).map(t => t.trim()).join('|') === '내 기록|캠핑팸 후기|회사캠핑 후기');
  check('sharedGroupIds가 없는 기존 기록은 공유 표시 없이 그대로', (await A.locator('.list-row:has-text("가평 숲속 야영장") .share-tag').count()) === 0 && (await A.locator('.list-row').count()) === 2);
  await editLog(A, '홍천 강변 캠핑장');
  check('기록 폼에 "그룹에 공유" 칩(그룹마다), 기본은 꺼짐', (await A.locator('.share-chip').count()) === 2 && (await A.locator('.share-chip.active').count()) === 0);
  await shareChip(A, '캠핑팸').click();
  await A.click('[data-action="camp-save"]');
  await settle();
  const k1 = `groups/${G1}/sharedReviews/${UA.uid}_c1`;
  const copy = server[k1] || {};
  check('공유 켜면 groups/{gid}/sharedReviews/{uid}_{logId}에 사본(후기 필드 전체 + authorUid·sourceLogId·updatedAt)',
    Object.keys(full).every(f => same(copy[f], full[f])) && copy.authorUid === UA.uid && copy.sourceLogId === 'c1' && !!copy.updatedAt && !('sharedGroupIds' in copy), copy);
  check('내 기록에 sharedGroupIds 저장 + 목록에 "캠핑팸 공유" 표시', same(server[A_ + 'campingLogs/c1'].sharedGroupIds, [G1]) && (await A.locator('.list-row:has-text("홍천 강변") .share-tag:has-text("캠핑팸 공유")').count()) === 1);
  await nav(B, 'camping');
  await view(B, '캠핑팸 후기');
  await B.waitForSelector('.review-card', { timeout: 3000 }).catch(() => {});
  const hongCard = B.locator('.review-card:has-text("홍천")');
  const hc = await hongCard.innerText().catch(() => '');
  check('B에게 그룹 후기로 보임: 캠핑장별로 묶음(이름 공백·대소문자 무시) 2개 후기', (await B.locator('.review-card').count()) === 2 && /후기 2개/.test(hc), hc);
  check('카드 요약: 지역·평균 평점(5,3→4.0)·최근 방문일·화장실(최빈값)', /홍천/.test(hc) && /4\.0/.test(hc) && /최근 방문 2026-09-20/.test(hc) && /화장실 좋음/.test(hc), hc);
  check('카드에 작성자 사진 2명', (await hongCard.locator('.review-authors .mini-avatar').count()) === 2);
  check('그룹 후기는 읽기 전용(추가 버튼 없음)', (await B.locator('[data-action="camp-new"]').count()) === 0);
  await hongCard.click();
  const det = await B.locator('#review-detail').innerText();
  check('카드를 누르면 멤버별 후기 전체(사이트·체크인/아웃·화장실·매점·메모·작성자·방문일)', /앨리스/.test(det) && /밥/.test(det) && /데크/.test(det) && /5x5m/.test(det) && /14:00~11:00/.test(det) && /매점 적당함/.test(det) && /계곡 옆/.test(det) && /2026-08-16 방문/.test(det), det);
  check('내가 쓴 후기에만 "내 기록에서 수정", 그룹장이 아니면 "내리기" 없음', (await B.locator('.review-row:has-text("밥") [data-action="review-edit-mine"]').count()) === 1
    && (await B.locator('.review-row:has-text("앨리스") [data-action="review-edit-mine"]').count()) === 0 && (await B.locator('[data-action="review-remove"]').count()) === 0);

  // ================= 2. 수정 → 사본 갱신 / 여러 그룹 / 끄기 =================
  await editLog(A, '홍천 강변 캠핑장');
  check('기존 공유 기록은 폼에서 공유 칩이 켜진 채로', (await shareChip(A, '캠핑팸').getAttribute('class')).includes('active'));
  await A.fill('#cf-notes', '계곡 옆, 밤에 추움');
  await shareChip(A, '회사캠핑').click();
  await A.click('[data-action="camp-save"]');
  await settle();
  const k2 = `groups/${G2}/sharedReviews/${UA.uid}_c1`;
  check('수정하면 공유 중인 사본도 갱신', server[k1] && server[k1].notes === '계곡 옆, 밤에 추움');
  check('여러 그룹에 공유: 두 그룹 모두 사본', !!server[k2] && server[k2].notes === '계곡 옆, 밤에 추움' && same(server[A_ + 'campingLogs/c1'].sharedGroupIds, [G1, G2]));
  await B.waitForFunction(() => /밤에 추움/.test(document.getElementById('review-detail') ? document.getElementById('review-detail').innerText : ''), null, { timeout: 3000 }).catch(() => {});
  check('B가 보고 있던 후기 창도 실시간 갱신', /밤에 추움/.test(await B.locator('#review-detail').innerText()));
  await B.click('[data-action="modal-close"]');
  await editLog(A, '홍천 강변 캠핑장');
  await shareChip(A, '회사캠핑').click();
  await A.click('[data-action="camp-save"]');
  await settle();
  check('공유를 끄면 그 그룹 사본만 삭제', !server[k2] && !!server[k1] && same(server[A_ + 'campingLogs/c1'].sharedGroupIds, [G1]));

  // ================= 3. 삭제 → 사본 삭제 → 되돌리기 → 사본 복구 =================
  const c1Before = JSON.parse(JSON.stringify(server[A_ + 'campingLogs/c1']));
  await A.click('.list-row:has-text("홍천 강변") [data-action="camp-del"]');
  check('공유 중인 기록 삭제 확인 모달에 그룹 후기도 사라진다고 안내', /캠핑팸.*후기도 함께 사라져요/.test(await A.locator('#modal-root').innerText()));
  await confirmYes(A);
  await settle();
  check('기록 삭제 → 모든 사본 삭제', !server[A_ + 'campingLogs/c1'] && !server[k1]);
  await B.waitForFunction(() => document.querySelectorAll('.review-card').length === 2 && !/후기 2개/.test(document.querySelector('.review-card:nth-child(1)').innerText + document.querySelector('.review-card:nth-child(2)').innerText), null, { timeout: 3000 }).catch(() => {});
  check('B 화면에서도 내 후기가 빠짐(홍천 후기 1개)', /후기 1개/.test(await B.locator('.review-card:has-text("홍천")').innerText()));
  await A.click('#toast [data-action="undo-delete"]');
  await settle();
  check('되돌리기 → 기록 + 사본 복구', same(server[A_ + 'campingLogs/c1'], c1Before) && !!server[k1] && server[k1].notes === '계곡 옆, 밤에 추움' && server[k1].authorUid === UA.uid);

  // ================= 4. 지역 필터·정렬 =================
  await B.waitForSelector('.review-card:has-text("후기 2개")', { timeout: 3000 }).catch(() => {});
  const names = async () => (await B.locator('.review-card .name').allInnerTexts()).map(s => s.trim());
  check('정렬 최신순: 홍천(9/20) → 양양(7/1)', same(await names(), ['홍천강변캠핑장', '양양 바다 캠핑장']) || same(await names(), ['홍천 강변 캠핑장', '양양 바다 캠핑장']), await names());
  await B.selectOption('[data-action="group-review-sort"]', 'rating_asc');
  await settle();
  check('정렬 평점 낮은순: 양양(2) → 홍천(4.0)', /양양/.test((await names())[0]), await names());
  await B.click('[data-action="group-review-filter"][data-cat="홍천"]');
  check('지역 필터(홍천)', (await B.locator('.review-card').count()) === 1 && /홍천/.test((await names())[0]));
  await B.click('[data-action="group-review-filter"][data-cat="all"]');

  // ================= 5. 그룹 일정 후기 남기기 → 그 그룹 공유 기본 켜짐 =================
  await nav(A, 'checklist');
  await A.locator('.space-chip:has-text("캠핑팸")').click();
  await settle();
  await A.click('[data-action="trip-past-toggle"]');
  await A.click('.trip-chip:has-text("팸 지난 캠핑")');
  await A.click('.trip-card [data-action="trip-review"]');
  await A.waitForSelector('#cf-name', { timeout: 3000 });
  check('그룹 일정에서 "후기 남기기" → 그 그룹 공유가 기본으로 켜짐', (await shareChip(A, '캠핑팸').getAttribute('class')).includes('active') && !(await shareChip(A, '회사캠핑').getAttribute('class')).includes('active'));
  await A.fill('#cf-rating', '4');
  await A.click('[data-action="camp-save"]');
  await settle();
  const tripLog = Object.entries(server).find(([k, v]) => k.startsWith(A_ + 'campingLogs/') && v.tripRef && v.tripRef.tripId === 'gt');
  const tripCopy = tripLog && server[`groups/${G1}/sharedReviews/${UA.uid}_${tripLog[0].split('/').pop()}`];
  check('저장하면 개인 기록 + 그룹 사본(tripRef 포함)', !!tripCopy && same(tripCopy.tripRef, { space: G1, tripId: 'gt' }) && tripCopy.rating === 4, tripCopy);
  // 개인 일정에서 온 후기는 기본 꺼짐
  await A.locator('.space-chip:has-text("내 공간")').click();
  await put(A_ + 'trips/pt', { title: '개인 지난 캠핑', startDate: ymd(-3), endDate: ymd(-3), campsiteName: '춘천', region: '춘천', createdBy: UA.uid, createdAt: 'x', updatedBy: UA.uid });
  await settle();
  await A.click('[data-action="trip-past-toggle"]');
  await A.click('.trip-chip:has-text("개인 지난 캠핑")');
  await A.click('.trip-card [data-action="trip-review"]');
  await A.waitForSelector('#cf-name', { timeout: 3000 });
  check('개인 일정·새 기록에서는 공유 기본 꺼짐', (await A.locator('.share-chip.active').count()) === 0);
  await A.click('[data-action="modal-close"]');

  // ================= 6. 그룹장 "그룹에서 내리기" =================
  await nav(A, 'camping');
  await view(A, '캠핑팸 후기');
  await A.click('.review-card:has-text("양양")');
  check('그룹장에게는 다른 사람 후기에 "그룹에서 내리기"', (await A.locator('.review-row:has-text("밥") [data-action="review-remove"]').count()) === 1);
  await A.click('.review-row:has-text("밥") [data-action="review-remove"]');
  check('내리기 전 확인(confirmModal)', /그룹에서 내릴까요/.test(await A.locator('#modal-root').innerText()));
  await confirmYes(A);
  await settle();
  check('그룹장이 내리면 사본만 삭제(작성자 개인 기록은 그대로)', !server[`groups/${G1}/sharedReviews/${UB.uid}_b2`] && !!server[B_ + 'campingLogs/b2']);
  check('A 화면에서 양양 카드가 사라짐', (await A.locator('.review-card:has-text("양양")').count()) === 0);

  // ================= 7. "내 기록에서 수정" =================
  await A.click('.review-card:has-text("홍천")');
  await A.click('.review-row:has-text("앨리스") [data-action="review-edit-mine"]');
  await A.waitForSelector('#cf-name', { timeout: 3000 });
  check('"내 기록에서 수정" → 내 기록 보기로 바뀌고 그 기록 수정 폼', (await A.inputValue('#cf-name')) === '홍천 강변 캠핑장' && (await A.locator('.camp-view-chip.active:has-text("내 기록")').count()) === 1);
  await A.click('[data-action="modal-close"]');

  // ================= 8. 나간 멤버 + 공유 정리 + 자기 사본 삭제 권한 =================
  await put(C_ + 'campingLogs/cc', { name: '양평 캠핑장', date: '2026-06-06', region: '양평', siteType: '데크', rating: 4, toiletCondition: '보통', storeCondition: '없음', notes: '', sharedGroupIds: [G1] });
  const C = await phone(UC);
  await nav(C, 'camping');
  await C.click('[data-action="camp-edit"]');
  await C.waitForSelector('#cf-name');
  await C.click('[data-action="camp-save"]');
  await settle();
  const ck = `groups/${G1}/sharedReviews/${UC.uid}_cc`;
  check('(준비) 캐롤 후기 사본', !!server[ck]);
  await nav(C, 'settings');
  await C.click('.group-row:has-text("캠핑팸") [data-action="group-leave"]');
  await confirmYes(C);
  await settle(); await settle();
  check('그룹을 나가도 내가 올린 사본은 그룹에 남음', !!server[ck] && !server['groups/' + G1].memberUids.includes(UC.uid));
  check('나간 그룹 gid는 내 기록의 sharedGroupIds에서 조용히 정리', same(server[C_ + 'campingLogs/cc'].sharedGroupIds, []), server[C_ + 'campingLogs/cc'].sharedGroupIds);
  await view(A, '내 기록');
  await view(A, '캠핑팸 후기');
  await A.click('.review-card:has-text("양평")');
  check('나간 멤버의 후기는 "나간 멤버"로 표시', /나간 멤버/.test(await A.locator('#review-detail').innerText()));
  await A.click('[data-action="modal-close"]');
  const cDel = await C.evaluate(async k => { const m = window.__FIREBASE_MODULES__.firestore; try { await m.deleteDoc(m.doc({}, k)); return 'ok'; } catch (e) { return e.code; } }, ck);
  check('(가짜 규칙) 나간 작성자도 자기 사본은 지울 수 있음', cDel === 'ok' && !server[ck], cDel);

  // ================= 9. 비멤버 =================
  const D = await phone(UD);
  await nav(D, 'camping');
  check('비멤버(그룹 없음)에게는 보기 전환·그룹 후기 없음', (await D.locator('.camp-view-chip').count()) === 0);
  const dRead = await D.evaluate(async g => { const m = window.__FIREBASE_MODULES__.firestore; try { await m.getDocs(m.collection({}, 'groups/' + g + '/sharedReviews')); return 'ok'; } catch (e) { return e.code; } }, G1);
  check('(가짜 규칙) 비멤버는 그룹 후기 읽기 거부', dRead === 'permission-denied', dRead);
  const tryB = (k, d) => B.evaluate(async ([k2, d2]) => { const m = window.__FIREBASE_MODULES__.firestore; try { if (d2) await m.setDoc(m.doc({}, k2), d2); else await m.deleteDoc(m.doc({}, k2)); return 'ok'; } catch (e) { return e.code; } }, [k, d]);
  check('(가짜 규칙) 남의 authorUid로 만들기 거부', (await tryB(`groups/${G1}/sharedReviews/${UB.uid}_z`, { authorUid: UA.uid, sourceLogId: 'z' })) === 'permission-denied');
  check('(가짜 규칙) 남의 id(uidAlice_…)로 만들기 거부', (await tryB(`groups/${G1}/sharedReviews/${UA.uid}_z`, { authorUid: UB.uid, sourceLogId: 'z' })) === 'permission-denied');
  check('(가짜 규칙) 일반 멤버가 남의 후기 삭제 거부', (await tryB(k1, null)) === 'permission-denied' && !!server[k1]);

  // ================= 10. 백업 가져오기 후 사본 맞춤 =================
  await nav(A, 'settings');
  await A.click('[data-action="backup-export"]');
  const backup = JSON.parse(await A.inputValue('#backup-text'));
  await A.click('[data-action="modal-close"]');
  await put(k1, null);   // 사본이 사라진 상황
  backup.campingLogs = backup.campingLogs.filter(c => c.id === 'c1' || c.id === 'c2');   // 일정 후기 기록은 백업에서 뺌 → 사본도 정리돼야 함
  await A.click('[data-action="backup-import"]');
  await A.fill('#backup-text-in', JSON.stringify(backup));
  await A.click('[data-action="backup-import-go"]');
  await confirmYes(A);
  await settle(); await settle();
  check('백업 가져오기 → sharedGroupIds 기준으로 사본 다시 만듦', !!server[k1] && server[k1].sourceLogId === 'c1');
  check('백업에 없는 기록의 사본은 삭제', !server[`groups/${G1}/sharedReviews/${UA.uid}_${tripLog[0].split('/').pop()}`]);
  check('그룹 백업에는 후기 사본이 들어가지 않음', await (async () => {
    await A.click('.group-row:has-text("캠핑팸") [data-action="group-backup-export"]');
    await A.waitForSelector('#backup-text');
    const gb = JSON.parse(await A.inputValue('#backup-text'));
    await A.click('[data-action="modal-close"]');
    return !('sharedReviews' in gb) && !JSON.stringify(gb).includes('authorUid');
  })());

  // ================= 11. 보기 기억 + Home 통계는 개인 기록만 =================
  await nav(B, 'camping');
  await view(B, '캠핑팸 후기');
  await B.reload();
  await B.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
  await nav(B, 'camping');
  await B.waitForSelector('.camp-view-chip.active:has-text("캠핑팸")', { timeout: 3000 }).catch(() => {});
  check('보기 선택은 기기에 기억(새로고침해도 캠핑팸 후기)', (await B.locator('.camp-view-chip.active:has-text("캠핑팸")').count()) === 1);
  check('보기 전환은 Checklist·Gear 공간과 따로', await B.evaluate(() => state.space) === 'me');
  await nav(B, 'home');
  const bCamp = await B.locator('.stat-card:has-text("캠핑 기록") .big-num').innerText();
  check('Home 캠핑 통계는 개인 기록만(밥 2개, 그룹 후기 미포함)', bCamp.trim() === '2', bCamp);

  // ================= 12. 그룹 삭제 시 후기 사본도 삭제 =================
  await nav(A, 'settings');
  await A.click('.group-row:has-text("캠핑팸") [data-action="group-delete"]');
  await confirmYes(A);
  await A.waitForSelector('[data-action="confirm-yes"]', { timeout: 2000 }).catch(() => {});
  await confirmYes(A);
  await settle(); await settle();
  check('그룹 삭제 시 sharedReviews도 함께 삭제', reviewKeys(G1).length === 0 && !server['groups/' + G1], reviewKeys(G1));
  await nav(B, 'camping');
  check('그룹이 없어지면 내 기록 보기로 돌아옴', (await B.evaluate(() => state.campView)) === 'me' && (await B.locator('.camp-view-chip.active:has-text("내 기록")').count()) === 1);
  check('밥의 sharedGroupIds에서도 삭제된 그룹이 정리됨', !(server[B_ + 'campingLogs/b1'].sharedGroupIds || []).includes(G1));

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
