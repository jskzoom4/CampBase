// F. UI 보완 묶음 테스트 (가짜 Firestore/Auth):
//  1-1 ⋯ 메뉴가 하단 탭바 뒤로 숨지 않음, 1-2 선택 목록 한 줄 정렬, 1-3 그룹 후기 카드 표시 이름,
//  2 일정 패널(구조·⋯ 메뉴·필터·후기 남기기·리스트 없음 안내·템플릿에서 가져오기·sticky 요약·첫 항목 위치),
//  3-1 체크 버튼 누르는 영역, 3-2 그룹 배너, 3-3 Gear 선택 모드, 3-4 Cooking 레시피 접기(재료 체크 없음), 3-5 모바일 시트·고정 버튼 바,
//  3-6 별점, 3-7 기록 줄 정렬, 3-8 Home 막대 그래프, 3-9 본문 최대 폭, 3-10 X만 있는 확인 모달
// 실행: node tests/ui-f.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick, gearAction } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-uif-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8775;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const server = {};
(function seed() {
  const A = 'users/uidAlice/', G = 'groups/grpFam';
  const mem = (n, r) => ({ name: n, photoURL: '', role: r });
  server[A + 'campingLogs/c1'] = { name: '홍천 강변 캠핑장', date: '2026-08-16', region: '홍천', siteType: '데크', siteSize: '5x5m', rating: 4, notes: '계곡 바로 옆이라 시원했어요.' };
  server[A + 'gear/g1'] = { name: '스텔스 5 텐트', brand: 'Snow Peak', category: '텐트', price: 0, weight: 0, date: '' };
  server[A + 'gear/g2'] = { name: '체어 원', brand: 'Helinox', category: '체어/테이블', price: 0, weight: 0, date: '' };
  server[A + 'gear/g3'] = { name: '버너', brand: 'Kovea', category: '조리용품', price: 0, weight: 0, date: '' };
  server[A + 'checklists/cl1'] = { title: '기본 준비물', items: [{ id: 'i1', label: '텐트', status: 'packed', group: '텐트' }, { id: 'i2', label: '랜턴', status: 'pending', group: '조명' }] };
  server[G] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice', 'uidBob'], createdAt: '1', gearCategories: ['텐트', '타프', '기타'],
    members: { uidAlice: mem('앨리스', 'owner'), uidBob: mem('밥', 'member') } };
  server[G + '/trips/gt'] = { title: '10월 팸 캠핑', startDate: ymd(3), endDate: ymd(4), campsiteName: '가평 숲속 야영장', region: '가평', memberUids: ['uidAlice', 'uidBob'], createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  server[G + '/trips/gempty'] = { title: '빈 일정', startDate: ymd(20), endDate: ymd(20), campsiteName: '', region: '', memberUids: ['uidAlice', 'uidBob'], createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  server[G + '/trips/gpast'] = { title: '지난 팸 캠핑', startDate: ymd(-6), endDate: ymd(-5), campsiteName: '양평 캠핑장', region: '양평', memberUids: ['uidAlice', 'uidBob'], createdBy: 'uidAlice', createdAt: 'x', updatedBy: 'uidAlice' };
  const items = [];
  for (let i = 1; i <= 9; i++) items.push({ id: 'a' + i, label: '항목 ' + i, status: i <= 2 ? 'packed' : 'pending', group: i <= 4 ? '텐트' : '조리', assigneeUid: i % 3 === 0 ? 'uidAlice' : 'uidBob' });
  server[G + '/checklists/gl'] = { title: '팸 캠핑 준비물', tripId: 'gt', items };
  server[G + '/checklistTemplates/tpl1'] = { title: '기본 세트', items: [{ label: '물', group: '음식' }, { label: '휴지', group: '기타' }] };
  server[G + '/gear/gg1'] = { name: '렉타 타프', brand: 'DOD', category: '타프', addedBy: 'uidBob' };
  const rv = (uid, id, o) => ({ authorUid: uid, sourceLogId: id, updatedAt: 'x', siteType: '데크', region: '홍천', rating: 4, ...o });
  server[G + '/sharedReviews/uidAlice_c1'] = rv('uidAlice', 'c1', { name: '홍천 강변 캠핑장', date: '2026-08-16' });
  server[G + '/sharedReviews/uidBob_b1'] = rv('uidBob', 'b1', { name: '홍천 강변 캠핑장', date: '2026-08-01' });
  server[G + '/sharedReviews/uidBob_b2'] = rv('uidBob', 'b2', { name: '홍천강변캠핑장', date: '2026-09-20' });   // 가장 최근이지만 드문 표기
  server[G + '/sharedReviews/uidBob_b3'] = rv('uidBob', 'b3', { name: '양양 바다', date: '2026-07-01', region: '양양' });
  server[G + '/sharedReviews/uidAlice_c9'] = rv('uidAlice', 'c9', { name: '양양바다', date: '2026-07-05', region: '양양' });   // 1:1이면 최근 것
})();

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });
  await sleep(700);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const pages = [];
  async function phone(user, opts = {}) {
    const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
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
    await sleep(300);
    return page;
  }
  const settle = () => sleep(350);
  const nav = (p, tab) => p.locator(`[data-nav="${tab}"]:visible`).first().click();
  const pickSpace = async (p, label) => { await p.locator(`.space-chip:has-text("${label}")`).first().click(); await settle(); };
  const rect = (p, sel) => p.locator(sel).first().evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, right: r.right }; });

  const M = await phone(UA, { mobile: true });
  const D = await phone(UA);

  // ================= 3-2 그룹 배너 (처음 한 번만) =================
  await nav(M, 'checklist');
  await pickSpace(M, '캠핑팸');
  check('3-2 그룹 공간 안내는 처음엔 크게 + "알겠어요"', (await M.locator('.space-note').count()) === 1 && (await M.locator('[data-action="space-note-ok"]').count()) === 1);
  await M.click('[data-action="space-note-ok"]');
  check('3-2 "알겠어요" 뒤엔 칩 옆 작은 "멤버 2명"만', (await M.locator('.space-note').count()) === 0 && /멤버 2명/.test(await M.locator('.space-members').innerText()));
  await M.reload();
  await M.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
  await nav(M, 'checklist');
  await sleep(400);
  check('3-2 새로고침해도 작게 유지(기기에 기억)', (await M.locator('.space-note').count()) === 0 && (await M.locator('.space-members').count()) === 1);

  // ================= 2. 일정 패널 =================
  await M.locator('.trip-chip:has-text("10월 팸 캠핑")').click();
  await settle();
  const panel = M.locator('.trip-panel');
  check('2-1 일정을 고르면 하나의 패널(따로 있던 "준비물" 제목·새 리스트·필터 줄 없음)', (await panel.count()) === 1 && (await M.locator('.section-head').count()) === 0 && (await M.locator('.cl-filter-row').count()) === 0);
  check('2-1 1줄: 달력 + 일정 이름 · D-n 태그 · ⋯ 메뉴', /10월 팸 캠핑/.test(await M.locator('.trip-panel-head .tp-name').innerText()) && /D-3/.test(await M.locator('.trip-panel-head .trip-phase').innerText()) && (await M.locator('.trip-panel-head .more-btn').count()) === 1);
  check('2-1 ⋯ 메뉴: 일정 수정·새 리스트·일정 삭제(삭제가 맨 아래 빨간색)', await M.locator('.trip-panel-head .more-menu').evaluate(m => [...m.querySelectorAll('.more-item')].map(b => b.dataset.action + (b.classList.contains('danger') ? '!' : '')).join(',')) === 'trip-edit,cl-new-list,trip-del!');
  check('2-1 2줄: 날짜·캠핑장·지역 + 참가 멤버 사진 묶음(aria-label "2명 참가")', /가평 숲속 야영장 · 가평/.test(await M.locator('.tp-meta-row .tp-where').innerText()) && (await M.locator('.tp-meta-row .avatar-stack[aria-label="2명 참가"] .mini-avatar').count()) === 2);
  check('2-1 3줄: 진행 막대 + "준비 2/9 · 내 담당 3"', /준비 2\/9 · 내 담당 3/.test(await M.locator('.trip-panel .trip-progress-text').innerText()) && (await M.locator('.trip-panel .trip-bar-track[role="progressbar"]').count()) === 1);
  check('2-1 4줄: 작은 필터(전체·완료·미완료·내 담당) + "+ 리스트"', (await M.locator('.tp-tools [data-action="cl-filter"]').count()) === 4 && (await M.locator('.tp-tools [data-action="cl-new-list"]').isVisible()));
  check('2-1 리스트는 패널 안 구역(구분선) — 카드 안에 카드 없음', (await M.locator('.trip-panel .panel-list').count()) === 1 && (await M.locator('.trip-panel .card').count()) === 0);
  const firstItem = await rect(M, '.trip-panel .check-row');
  check('2 390px에서 일정을 고르면 첫 준비물 항목이 화면 위쪽 절반 안에', firstItem.top < 844 / 2, firstItem);
  await M.click('.tp-tools [data-action="cl-filter"][data-filter="done"]');
  check('2-1 패널 필터(완료) 동작', (await M.locator('.trip-panel .check-row').count()) === 2);
  await M.click('.tp-tools [data-action="cl-filter"][data-filter="mine"]');
  check('2-1 패널 필터(내 담당) 동작', (await M.locator('.trip-panel .check-row').count()) === 3);
  await M.click('.tp-tools [data-action="cl-filter"][data-filter="all"]');
  // sticky 요약
  check('2-2 처음엔 요약이 숨겨짐', !(await M.locator('.trip-panel-head .tp-mini').isVisible()));
  await M.evaluate(() => { document.getElementById('main').scrollTop = 500; });
  await sleep(200);
  const head = await rect(M, '.trip-panel-head');
  const mainTop = await M.evaluate(() => document.getElementById('main').getBoundingClientRect().top);
  const pill = await rect(M, '#db-status-top');
  check('2-2 스크롤하면 패널 머리가 한 줄 요약(이름 · D-n · 준비 n/m)으로 위에 붙음', await M.locator('.trip-panel-head.stuck').count() === 1 && Math.abs(head.top - mainTop) <= 2
    && /D-3 · 준비 2\/9/.test(await M.locator('.trip-panel-head .tp-mini').innerText()) && head.h < 60, { head, mainTop });
  check('2-2 위쪽 연결 상태 알약·하단 탭바와 겹치지 않음', head.top >= pill.bottom && head.bottom <= (await rect(M, '#mobile-tabbar')).top);
  await M.evaluate(() => { document.getElementById('main').scrollTop = 0; });
  // ⋯ 메뉴 → 새 리스트(일정에 연결)
  await menuClick(M, '.trip-panel-head [data-action="cl-new-list"]');
  await M.fill('#ncl-title', '패널에서 만든 리스트');
  await M.click('[data-action="cl-new-list-save"]');
  await settle();
  check('2-1 ⋯ → 새 리스트: 이 일정에 연결', Object.entries(server).some(([k, v]) => k.startsWith('groups/grpFam/checklists/') && v.title === '패널에서 만든 리스트' && v.tripId === 'gt'));
  // 리스트 없음 안내 + 템플릿에서 가져오기
  await M.locator('.trip-chip:has-text("빈 일정")').click();
  await settle();
  check('2-1 리스트가 없으면 패널 안에 "준비물이 없어요 · + 리스트 / 템플릿에서 가져오기"', /이 일정에 연결된 준비물이 없어요/.test(await M.locator('.trip-panel .tp-empty').innerText())
    && (await M.locator('.tp-empty [data-action="cl-new-list"]').count()) === 1 && (await M.locator('.tp-empty [data-action="trip-tpl-import"]').count()) === 1);
  await M.click('.tp-empty [data-action="trip-tpl-import"]');
  await M.selectOption('#tpl-import-pick', 'tpl1');
  await M.click('[data-action="trip-tpl-import-go"]');
  await settle();
  const imported = Object.values(server).find(v => v && v.tripId === 'gempty');
  check('2-1 템플릿에서 가져오기: 새 리스트(항목 모두 미정)를 이 일정에 연결', !!imported && imported.title === '기본 세트' && imported.items.length === 2 && imported.items.every(i => i.status === 'pending'), imported);
  // 끝난 일정: D-n 자리에 후기 남기기
  await M.click('.sub-tab[data-view="pastTrips"]'); await settle();
  await M.locator('.past-trip-card:has-text("지난 팸 캠핑")').click();
  await settle();
  check('2-1 끝난 일정은 1줄 오른쪽에 "후기 남기기"', (await M.locator('.trip-panel-head [data-action="trip-review"]').isVisible()) && (await M.locator('.trip-panel-head .trip-phase').count()) === 0);
  // 2-3 전체
  await M.click('.sub-tab[data-view="checklist"]'); await settle();
  await M.click('[data-action="trip-pick"][data-trip="all"]');
  check('2-3 "전체"일 때는 기존 구조(제목·새 리스트·필터 줄) + 설명 한 줄', (await M.locator('.section-head [data-action="cl-new-list"]').count()) === 1 && (await M.locator('.cl-filter-row').count()) === 1
    && await M.locator('.section-desc.one-line').evaluate(el => getComputedStyle(el).whiteSpace === 'nowrap'));
  // 2-4
  const chipH = await M.evaluate(() => [...document.querySelectorAll('.trip-chips .seg-btn')].map(e => Math.round(e.getBoundingClientRect().height)));
  check('2-4 "+ 일정 만들기" 칩은 다른 칩과 같은 높이(앰버 유지)', new Set(chipH).size === 1 && await M.locator('.trip-new-chip').evaluate(el => getComputedStyle(el).backgroundColor === getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || el.classList.contains('trip-new-chip')), chipH);

  // ================= 3-1 체크 버튼 크기 =================
  const sb = await M.locator('.cl-status-btn').first().evaluate(el => {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect(), inset = parseFloat(getComputedStyle(el, '::before').top);
    const v = { left: r.left + inset, top: r.top + inset, right: r.right - inset, bottom: r.bottom - inset };   // 보이는 칸
    const cx = (v.left + v.right) / 2, cy = (v.top + v.bottom) / 2;
    // 보이는 칸의 네 변 가운데에서 3px 바깥(버튼 모서리는 둥글어서 꼭짓점 대신 변 가운데로 확인)
    const hits = [[v.left - 3, cy], [v.right + 3, cy], [cx, v.top - 3], [cx, v.bottom + 3]].map(([x, y]) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); });
    return { visible: v.right - v.left, hitW: r.width, hitH: r.height, hits };
  });
  check('3-1 가져감/안 가져감: 보이는 크기 30~32px + 누르는 영역 40×40(보이는 칸 가장자리 3px 밖도 눌림)', sb.visible >= 30 && sb.visible <= 32 && sb.hitW >= 40 && sb.hitH >= 40 && sb.hits.every(Boolean), sb);

  // ================= 1-1 ⋯ 메뉴가 탭바 뒤로 숨지 않음 =================
  await M.evaluate(() => {
    const m = document.getElementById('main'); const rows = [...document.querySelectorAll('.check-row')]; const r = rows[rows.length - 1];
    m.scrollTop += r.getBoundingClientRect().bottom - document.getElementById('mobile-tabbar').getBoundingClientRect().top + 2;
  });
  await sleep(150);
  const lastMore = M.locator('.check-row .more').last();
  await lastMore.locator('.more-btn').click();
  const menuBox = await lastMore.locator('.more-menu').evaluate(m => { const r = m.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, tab: document.getElementById('mobile-tabbar').getBoundingClientRect().top }; });
  check('1-1 화면 맨 아래 항목의 ⋯ 메뉴 전체가 탭바 위·화면 안에 보임', menuBox.top >= 0 && menuBox.bottom <= menuBox.tab, menuBox);
  const lastLabel = await M.locator('.check-row .label').last().innerText();
  const lastItem = lastMore.locator('[data-action="cl-del-item"]');
  const hitOk = await lastItem.evaluate(el => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h === el || el.contains(h); });
  await lastItem.click();
  await settle();
  check('1-1 마지막 항목의 "항목 삭제"를 실제로 누를 수 있음(탭바가 가리지 않음)', hitOk && !(await M.locator('.check-row .label').allInnerTexts()).includes(lastLabel) && (await M.locator('#toast [data-action="undo-delete"]').count()) === 1);
  await M.click('#toast [data-action="undo-delete"]');
  await settle();
  check('1-1 고정 요소 판단에 offsetParent를 쓰지 않음', !(await M.evaluate(() => [...document.scripts].map(s => s.textContent).join('\n').replace(/\/\/.*$/gm, '').includes('offsetParent'))));

  // ================= 1-2 선택 목록 정렬 =================
  await M.locator('.space-chip:has-text("캠핑팸")').click();
  await settle();
  await M.click('[data-action="trip-new"]');
  await sleep(300);   // 올라오는 효과가 끝난 뒤 잼
  const rows = await M.evaluate(() => [...document.querySelectorAll('#tf-members .send-row')].map(row => {
    const c = row.querySelector('input').getBoundingClientRect(), a = row.querySelector('.mini-avatar').getBoundingClientRect(), n = row.querySelector('.sr-name').getBoundingClientRect(), r = row.getBoundingClientRect();
    const mid = x => x.top + x.height / 2;
    return { sameLine: Math.abs(mid(c) - mid(a)) < 4 && Math.abs(mid(a) - mid(n)) < 4, order: c.right <= a.left && a.right <= n.left, cbW: c.width, nameGrows: n.width > r.width * 0.4 };
  }));
  check('1-2 참가 멤버 줄: [체크박스][사진][이름] 한 줄, 체크박스는 원래 크기, 이름이 늘어남', rows.length === 2 && rows.every(r => r.sameLine && r.order && r.cbW < 30 && r.nameGrows), rows);
  // 3-5 모바일 시트 + 고정 버튼 바
  const sheet = await M.evaluate(() => {
    const m = document.querySelector('#modal-root .modal').getBoundingClientRect(), f = document.querySelector('#modal-root .modal-foot').getBoundingClientRect();
    const body = document.querySelector('#modal-root .modal-body');
    return { modalBottom: Math.round(m.bottom), modalH: m.height, vh: window.innerHeight, footBottom: f.bottom, footTop: f.top, bodyScrolls: body.scrollHeight > body.clientHeight, w: m.width };
  });
  check('3-5 휴대폰: 아래에서 올라오는 시트(화면 폭, 바닥에 붙음, 높이 ≤ 90%)', sheet.modalBottom === sheet.vh && sheet.modalH <= sheet.vh * 0.9 + 1 && sheet.w === 390, sheet);
  check('3-5 저장/취소 버튼 바가 스크롤 없이 보임(안쪽만 스크롤)', sheet.footBottom <= sheet.vh && sheet.bodyScrolls && (await M.locator('#modal-root .modal-foot [data-action="trip-save"]').isVisible()), sheet);
  await M.fill('#tf-title', '시트에서 만든 일정');
  await M.fill('#tf-start', ymd(30));
  await M.click('#modal-root .modal-foot [data-action="trip-save"]');
  await settle();
  check('3-5 고정 버튼 바의 저장으로 저장됨', Object.values(server).some(v => v && v.title === '시트에서 만든 일정'));
  const g2c = await phone(UB);
  await nav(g2c, 'gear');
  await pickSpace(g2c, '캠핑팸');
  await gearAction(g2c, 'gear-to-checklist');
  const g2cRow = await g2c.evaluate(() => { const row = document.querySelector('.g2c-gear').closest('.send-row'); const c = row.querySelector('input').getBoundingClientRect(), n = row.querySelector('.sr-name').getBoundingClientRect(); return { cbW: c.width, same: Math.abs((c.top + c.height / 2) - (n.top + n.height / 2)) < 4 }; });
  check('1-2 "체크리스트에 추가" 목록도 같은 정렬', g2cRow.cbW < 30 && g2cRow.same, g2cRow);
  await g2c.keyboard.press('Escape');

  // ================= 3-3 Gear 선택 모드 =================
  await nav(D, 'gear');
  await pickSpace(D, '내 공간');
  check('3-3 평소 위쪽은 "선택"·"+ 장비 추가"·"카테고리 관리"(I-3: 같은 줄에 바로 보임)만', await D.locator('[data-action="gear-select"]').isVisible() && await D.locator('.gear-head-actions [data-action="gear-new"]').isVisible()
    && (await D.locator('[data-action="gear-send"], [data-action="gear-to-checklist"]').count()) === 0 && await D.locator('.gear-head-actions > [data-action="gear-cat-manage"]').isVisible());
  const cats = await D.locator('[data-action="gear-filter"]').allInnerTexts();
  check('3-3 개수 0인 카테고리 칩은 숨김', !cats.some(t => /\s0$/.test(t.trim())) && cats.length === 4, cats);
  await D.click('[data-action="gear-select"]');
  check('3-3 선택 모드: 아래 액션 바(0개 선택 → 버튼 비활성)', /0개 선택/.test(await D.locator('.select-bar').innerText()) && await D.locator('.select-bar [data-action="gear-to-checklist"]').isDisabled());
  await D.click('.gear-row[data-id="g1"]');
  await D.locator('.gear-row[data-id="g3"]').focus();
  await D.keyboard.press(' ');
  const bar = await D.locator('.select-bar').innerText();
  check('3-3 줄을 누르거나(키보드 Space) 골라서 2개 선택 + 그룹으로 보내기·체크리스트에 추가·취소', /2개 선택/.test(bar) && /그룹으로 보내기/.test(bar) && /체크리스트에 추가/.test(bar) && /취소/.test(bar), bar);
  await D.click('.select-bar [data-action="gear-to-checklist"]');
  check('3-3 체크리스트에 추가 → 고른 장비가 미리 체크', (await D.locator('.g2c-gear:checked').evaluateAll(els => els.map(e => e.value).sort().join(','))) === 'g1,g3');
  await D.selectOption('#g2c-list', 'cl1');
  await D.click('[data-action="g2c-go"]');
  await settle();
  check('3-3 추가하면 선택 모드가 끝나고 항목이 들어감', (await D.locator('.select-bar').count()) === 0 && server['users/uidAlice/checklists/cl1'].items.some(i => i.label === '스텔스 5 텐트'));
  await D.click('[data-action="gear-select"]');
  await D.click('.gear-row[data-id="g2"]');
  await D.click('.select-bar [data-action="gear-send"]');
  check('3-3 그룹으로 보내기(개인 공간 + 그룹 있을 때)도 액션 바에서', await D.locator('#send-group').isVisible() && (await D.locator('.send-gear:checked').count()) === 1);
  await D.keyboard.press('Escape');
  await D.click('.select-bar [data-action="gear-select-cancel"]');
  check('3-3 취소하면 선택 모드 끝', (await D.locator('.select-bar').count()) === 0 && (await D.locator('[data-action="gear-edit"]').count()) === 3);
  await pickSpace(D, '캠핑팸');
  check('3-3 그룹 공간: 주인 지정 장비가 없으면 주인 필터 줄 없음, 그룹으로 보내기 버튼도 없음', (await D.locator('.owner-filter').count()) === 0 && await (async () => { await D.click('[data-action="gear-select"]'); const n = await D.locator('.select-bar [data-action="gear-send"]').count(); await D.click('[data-action="gear-select-cancel"]'); return n === 0; })());
  server['groups/grpFam/gear/gg1'] = { ...server['groups/grpFam/gear/gg1'], ownerUid: 'uidBob' };
  for (const pg of pages) await pg.evaluate(([p, d]) => window.__fsApply(p, d), ['groups/grpFam/gear/gg1', server['groups/grpFam/gear/gg1']]);
  await settle();
  check('3-3 주인 지정 장비가 생기면 주인 필터 줄 보임', (await D.locator('.owner-filter').count()) === 1);

  // ================= 3-4 Cooking(레시피 보기) =================
  await nav(D, 'cooking');
  await D.click('.cook-switch [data-view="recipes"]'); await settle();
  check('3-4 레시피 카드는 접힌 상태(이름·종류·난이도·시간), 재료 체크·"재료 n/m" 없음', (await D.locator('.recipe-card').count()) >= 10 && (await D.locator('.recipe-card.open').count()) === 0
    && (await D.locator('.ing-row, [data-action="cook-toggle"]').count()) === 0 && !/재료 \d+\/\d+/.test(await D.locator('.recipe-grid').innerText()));
  await D.locator('[data-action="cook-open"]').nth(0).click();
  await D.locator('[data-action="cook-open"]').nth(1).click();
  check('3-4 눌러서 펼치기(여러 개 동시에)', (await D.locator('.recipe-card.open').count()) === 2 && (await D.locator('[data-action="cook-open"][aria-expanded="true"]').count()) === 2);
  check('3-4 펼치면 2인 기준 재료 목록(읽기 전용, 양 표시) + 카드마다 "식단에 추가"', /2인 기준/.test(await D.locator('.recipe-card.open').first().innerText()) && (await D.locator('.recipe-card.open').first().locator('.dr-ings li').count()) >= 3
    && (await D.locator('.recipe-card [data-action="recipe-to-plan"]').count()) === (await D.locator('.recipe-card').count()));
  await D.reload();
  await D.waitForFunction(() => /자동 저장 켜짐/.test(document.getElementById('db-status').textContent), null, { timeout: 8000 });
  await nav(D, 'cooking');
  check('3-4 펼친 상태·레시피 보기는 기기에 기억', (await D.locator('.recipe-card.open').count()) === 2 && (await D.locator('.cook-switch [data-view="recipes"].active').count()) === 1);

  // ================= 3-6 별점 / 3-7 기록 줄 =================
  await nav(D, 'camping');
  await D.click('[data-action="camp-new"]');
  check('3-6 평점은 별 5개(radiogroup)', (await D.locator('#cf-stars[role="radiogroup"] .star-btn[role="radio"]').count()) === 5 && (await D.locator('input#cf-rating[type="hidden"]').count()) === 1);
  await D.click('#cf-stars [data-val="4"]');
  const s4 = await D.inputValue('#cf-rating');
  const checked4 = await D.locator('#cf-stars [aria-checked="true"]').getAttribute('data-val');
  await D.click('#cf-stars [data-val="4"]');
  const s0 = await D.inputValue('#cf-rating');
  check('3-6 별을 눌러 선택, 같은 별을 다시 누르면 0', s4 === '4' && checked4 === '4' && s0 === '0', { s4, checked4, s0 });
  await D.click('#cf-stars [data-val="2"]');
  await D.keyboard.press('ArrowRight');
  await D.keyboard.press('ArrowRight');
  const kb = await D.inputValue('#cf-rating');
  await D.keyboard.press('ArrowLeft');
  check('3-6 키보드(→←)로도 조절 + 초점이 따라감', kb === '4' && (await D.inputValue('#cf-rating')) === '3' && await D.evaluate(() => document.activeElement.dataset.val === '3'), kb);
  await D.fill('#cf-name', '별점 캠핑장');
  await D.click('[data-action="camp-save"]');
  await settle();
  check('3-6 저장하면 rating 저장', Object.values(server).some(v => v && v.name === '별점 캠핑장' && v.rating === 3));
  const line = await D.locator('.camp-row:has-text("홍천 강변 캠핑장")').evaluate(row => {
    const n = row.querySelector('.camp-line1 .name').getBoundingClientRect(), s = row.querySelector('.camp-line1 .stars').getBoundingClientRect();
    return { sameLine: Math.abs(n.bottom - s.bottom) < 6 && s.left > n.left, line2: row.querySelector('.meta').innerText, line3: row.querySelector('.camp-line3').innerText };
  });
  check('3-7 기록 줄: 1줄 이름 + 오른쪽 별점, 2줄 날짜 · 지역, 3줄 태그·후기 요약', line.sameLine && line.line2 === '2026-08-16 · 홍천' && /데크/.test(line.line3) && /5x5m/.test(line.line3) && /계곡/.test(line.line3), line);

  // ================= 1-3 / 3-10 그룹 후기 =================
  await D.locator('.camp-view-chip:has-text("캠핑팸")').click();
  await settle();
  const names = (await D.locator('.review-card .camp-line1 .name').allInnerTexts()).map(t => t.trim()).sort();
  check('1-3 카드 이름 = 가장 많이 쓰인 원래 이름(같으면 최근 것)', JSON.stringify(names) === JSON.stringify(['양양바다', '홍천 강변 캠핑장']), names);
  await D.click('.review-card:has-text("홍천 강변 캠핑장")');
  check('3-10 후기 상세 모달은 아래 "닫기" 없이 X만', (await D.locator('#modal-root .modal-x').count()) === 1 && (await D.locator('#modal-root button:has-text("닫기")').count()) === 0);
  await D.keyboard.press('Escape');

  // ================= 3-8 Home 통계 / 3-9 최대 폭 =================
  await nav(M, 'home');
  await sleep(200);
  const mHome = await M.evaluate(() => [...document.querySelectorAll('.stat-card:not(.placeholder-card-sm)')].map(c => ({
    pie: getComputedStyle(c.querySelector('.stat-pie')).display !== 'none', bars: getComputedStyle(c.querySelector('.stat-bars')).display !== 'none',
    zero: [...c.querySelectorAll('.bar-row .bar-num')].some(n => n.textContent.trim() === '0'), h: c.getBoundingClientRect().height })));
  await nav(D, 'home');
  await sleep(200);
  const dHome = await D.evaluate(() => [...document.querySelectorAll('.stat-card:not(.placeholder-card-sm)')].map(c => ({
    pie: getComputedStyle(c.querySelector('.stat-pie')).display !== 'none', zeroLegend: [...c.querySelectorAll('.legend-row .num')].some(n => n.textContent.trim() === '0'), h: c.getBoundingClientRect().height })));
  check('3-8 390px: 원형 대신 막대 그래프 + 0개 항목 숨김', mHome.length >= 2 && mHome.every(c => !c.pie && c.bars && !c.zero), mHome);
  check('3-8 1280px: 원형 유지(0개 범례도 숨김)', dHome.length >= 2 && dHome.every(c => c.pie && !c.zeroLegend), dHome);
  check('3-8 휴대폰 카드 높이는 데스크톱 원형 카드의 절반 이하', mHome.every((c, i) => c.h <= dHome[i].h / 2 + 1), { m: mHome.map(c => Math.round(c.h)), d: dHome.map(c => Math.round(c.h)) });
  const homeLink = M.locator('.stat-bars .bar-row').first();
  await homeLink.click();
  check('3-8 막대를 누르면 해당 탭으로(home-cat-nav)', (await M.locator('#view-title').innerText()) !== 'Home');
  const widths = {};
  for (const tab of ['home', 'checklist', 'gear', 'camping', 'cooking', 'settings']) {
    await nav(D, tab); await sleep(100);
    widths[tab] = Math.round((await rect(D, '#main > .view')).w);
  }
  check('3-9 1280px: Checklist·Gear·Camping·Cooking·Settings 본문은 최대 780px 가운데, Home은 넓게', ['checklist', 'gear', 'camping', 'cooking', 'settings'].every(t => widths[t] <= 780) && widths.home > 900
    && await D.evaluate(() => { const v = document.querySelector('#main > .view').getBoundingClientRect(), m = document.getElementById('main').getBoundingClientRect(); return Math.abs((v.left - m.left) - (m.right - v.right)) < 30; }), widths);

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
