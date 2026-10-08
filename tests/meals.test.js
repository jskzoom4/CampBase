// 캠핑 식단·장보기 테스트 (가짜 Firestore/Auth):
//  끼니 칸 자동 구성(2박·1박·당일), 메뉴 넣기(레시피·직접 입력)·옮기기·빼기(되돌리기), 끼니 추가, 인원 변경, 다 먹었어요, 날짜 밖 끼니,
//  양 계산(인원 배수·끼니별 인원·합산·올림·단위 다름·적당량), 장보기 목록 만들기(kind shopping, 분류·집에서 챙길 것, 진행률),
//  식단 변경 시 자동 맞춤(체크·담당자·고친 양·집에 있음·직접 추가 유지, 빠진 재료 처리, 목록 삭제 뒤 재생성 안 함),
//  그룹 일정(실시간, 메뉴 담당자 → 재료 담당자, 동시 수정, 개인 공간을 보고 있어도 그룹에 저장),
//  일정 패널·Home·지난 일정 카드의 식단 요약과 이동, 레시피 탭 없음 + 메뉴 직접 입력(이름·재료 → 장보기, 고치기), 하위 호환·백업 왕복, 일정 삭제 되돌리기.
// 실행: node tests/meals.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { menuClick } = require('./ui-helpers');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-meals-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8782;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const UB = { uid: 'uidBob', displayName: '밥', email: 'bob@example.com', photoURL: '' };
const UC = { uid: 'uidCarol', displayName: '캐롤', email: 'carol@example.com', photoURL: '' };

const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ymd = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  process.on('exit', () => { try { srv.kill(); } catch (e) {} });   // 실패로 끝나도 서버를 남기지 않음(남으면 다음 실행이 예전 코드를 받음)
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
  const confirmYes = async p => { await p.waitForSelector('[data-action="confirm-yes"]', { timeout: 3000 }); await p.click('[data-action="confirm-yes"]'); };
  const pickTrip = async (p, title) => { await p.locator(`.cook-trip-chip:has-text("${title}")`).first().click(); await settle(); };
  const row = (p, mid) => p.locator(`.meal-row[data-meal-row="${mid}"]`);
  async function addMenu(p, mid, recipeIds, custom, ings) {
    await row(p, mid).locator('[data-action="meal-add-dish"]').click();
    await p.waitForSelector('#mp-custom', { timeout: 3000 });
    if (custom) await p.fill('#mp-custom', custom);
    if (ings) await p.fill('#mp-ings', ings);
    if ((recipeIds || []).length) await p.locator('.mp-recipes summary').click();   // 레시피는 "레시피에서 고르기"를 펼쳐서
    for (const r of recipeIds || []) await p.locator(`.mp-pick[value="${r}"]`).check();
    await p.click('[data-action="mp-go"]');
    await settle();
  }
  const A_ = 'users/' + UA.uid + '/';
  const G = 'grpFam', G_ = 'groups/' + G + '/';
  const trip = (base, id) => server[base + 'trips/' + id] || {};
  const meal = (base, id, mid) => (trip(base, id).meals || []).find(m => m.id === mid);
  const shopOf = (base, tripId) => Object.entries(server).filter(([k, v]) => k.startsWith(base + 'checklists/') && v.tripId === tripId && v.kind === 'shopping').map(([k, v]) => ({ key: k, id: k.split('/').pop(), ...v }));
  const item = (list, label) => (list.items || []).find(i => i.label === label);
  const mem = (n, r) => ({ name: n, photoURL: '', role: r });

  // ---- 준비 ----
  server[A_ + 'trips/t2'] = { title: '2박 홍천', startDate: ymd(5), endDate: ymd(7), campsiteName: '홍천 강변', region: '홍천', createdBy: UA.uid, createdAt: 'x', updatedBy: UA.uid };
  server[A_ + 'trips/t1'] = { title: '1박 가평', startDate: ymd(12), endDate: ymd(13), campsiteName: '가평', region: '가평', createdBy: UA.uid, createdAt: 'x', updatedBy: UA.uid };
  server[A_ + 'trips/t0'] = { title: '당일 피크닉', startDate: ymd(20), endDate: ymd(20), createdBy: UA.uid, createdAt: 'x', updatedBy: UA.uid };
  server[A_ + 'trips/tp'] = { title: '지난 춘천', startDate: ymd(-12), endDate: ymd(-11), createdBy: UA.uid, createdAt: 'x', updatedBy: UA.uid,
    meals: [{ id: 'm1_dinner', day: 1, slot: 'dinner', dishes: [{ id: 'dp1', recipeId: 'ck1', name: '삼겹살 구이' }, { id: 'dp2', name: '라면' }] }] };
  server[A_ + 'checklists/old'] = { title: '기본 준비물', tripId: 't2', items: [{ id: 'o1', label: '텐트', status: 'pending', group: '텐트' }] };
  server['groups/' + G] = { name: '캠핑팸', ownerUid: UA.uid, memberUids: [UA.uid, UB.uid], createdAt: '1', gearCategories: [],
    members: { [UA.uid]: mem('앨리스', 'owner'), [UB.uid]: mem('밥', 'member') } };
  server[G_ + 'trips/gt'] = { title: '팸 캠핑', startDate: ymd(3), endDate: ymd(4), campsiteName: '양평', region: '양평', memberUids: [UA.uid, UB.uid], createdBy: UA.uid, createdAt: 'x', updatedBy: UA.uid };

  const A = await phone(UA);
  await A.evaluate(() => { try { localStorage.removeItem('campbase.cookView'); } catch (e) {} });

  // ================= 1. Cooking 탭 기본: 식단표, 가장 가까운 일정 =================
  await nav(A, 'cooking'); await settle();
  check('N-3 Cooking은 식단표만(레시피 탭 없음)', (await A.locator('.meal-summary').count()) === 1 && (await A.locator('.cook-switch, [data-action="cook-view"], .recipe-card').count()) === 0);
  check('2-2 일정 칩: 내 일정 + 그룹 일정(그룹 이름 작게), 가장 가까운 일정이 기본 선택', (await A.locator('.cook-trip-chip.active:has-text("팸 캠핑")').count()) === 1
    && /캠핑팸/.test(await A.locator('.cook-trip-chip:has-text("팸 캠핑") .cook-grp').innerText()) && (await A.locator('.cook-trip-chip').count()) === 4);
  check('2-2 지난 일정은 "지난 일정" 접기 안에', (await A.locator('.cook-trip-chip:has-text("지난 춘천")').count()) === 0 && (await A.locator('[data-action="cook-past-toggle"]').count()) === 1);
  check('2-2 Cooking에는 공간 전환 칩이 없음', (await A.locator('.space-chip').count()) === 0);

  // 끼니 칸 자동 구성
  await pickTrip(A, '2박 홍천');
  const slots = async () => A.locator('.meal-day').evaluateAll(ds => ds.map(d => [...d.querySelectorAll('.meal-name')].map(x => x.textContent.trim()).join(',')));
  check('2-3 2박: 첫날 점심·저녁, 중간 아침·점심·저녁, 마지막 아침·점심', same(await slots(), ['점심,저녁', '아침,점심,저녁', '아침,점심']), await slots());
  check('2-3 날짜 묶음 제목 "1일차 · n월 n일(요일)"', /^1일차 · \d+월 \d+일\([일월화수목금토]\)$/.test((await A.locator('.meal-day h3').first().innerText()).trim()), await A.locator('.meal-day h3').first().innerText());
  check('2-3 요약: "식단 0/7끼 정함 · 기본 2명", 메뉴가 없으면 장보기 목록 만들기 비활성', /식단 0\/7끼 정함/.test(await A.locator('.meal-summary').innerText()) && /기본 2명/.test(await A.locator('.ms-base').innerText())
    && await A.locator('[data-action="shop-create"]').isDisabled());
  await pickTrip(A, '1박 가평');
  check('2-3 1박: 첫날 점심·저녁, 마지막 날 아침·점심', same(await slots(), ['점심,저녁', '아침,점심']), await slots());
  await pickTrip(A, '당일 피크닉');
  check('2-3 당일치기: 점심·저녁', same(await slots(), ['점심,저녁']), await slots());
  check('1-2 meals 없는 기존 일정은 저장하지 않고 빈 칸만', trip(A_, 't0').meals === undefined);

  // ================= 2. 메뉴 넣기 · 인원 · 장보기 =================
  await pickTrip(A, '2박 홍천');
  await addMenu(A, 'm1_dinner', ['ck1', 'ck10'], '라면');
  let m1 = meal(A_, 't2', 'm1_dinner');
  check('2-3 메뉴 고르기(레시피 여러 개 + 직접 입력) → 일정 문서 meals에 저장', !!m1 && m1.day === 1 && m1.slot === 'dinner' && same(m1.dishes.map(d => d.name), ['라면', '삼겹살 구이', '김치찌개'])
    && m1.dishes[1].recipeId === 'ck1' && !m1.dishes[0].recipeId && trip(A_, 't2').title === '2박 홍천' && trip(A_, 't2').campsiteName === '홍천 강변', m1);
  check('2-3 메뉴 칩 3개 + 요약 1/7끼', (await row(A, 'm1_dinner').locator('.dish-chip').count()) === 3 && /식단 1\/7끼 정함/.test(await A.locator('.meal-summary').innerText()));
  await row(A, 'm1_dinner').locator('.dish-chip:has-text("삼겹살") [data-action="dish-open"]').click(); await settle();
  check('2-3 메뉴 칩을 누르면 레시피 펼침(이 끼니 인원 2명 기준 양)', /삼겹살\s*400g/.test(await row(A, 'm1_dinner').locator('.dish-recipe').innerText()) && /2명 기준/.test(await row(A, 'm1_dinner').locator('.dish-recipe').innerText()));
  // 기본 인원 4명
  await A.click('.ms-base'); await A.fill('#sv-n', '4'); await A.click('[data-action="sv-save"]:not([data-reset])'); await settle();
  check('2-3 기본 인원 변경 → mealServings 저장, 펼친 레시피 양도 4명 기준(800g)', trip(A_, 't2').mealServings === 4 && /삼겹살\s*800g/.test(await row(A, 'm1_dinner').locator('.dish-recipe').innerText()));
  // 끼니별 인원: 2일차 점심 2명 + 된장찌개
  await addMenu(A, 'm2_lunch', ['ck11']);
  await row(A, 'm2_lunch').locator('[data-action="meal-servings"]').click(); await A.fill('#sv-n', '2'); await A.click('[data-action="sv-save"]:not([data-reset])'); await settle();
  check('2-3 끼니 인원(기본과 다르면 강조)', meal(A_, 't2', 'm2_lunch').servings === 2 && (await row(A, 'm2_lunch').locator('.meal-serv.diff').count()) === 1 && (await row(A, 'm1_dinner').locator('.meal-serv.diff').count()) === 0);
  // 3일차 아침: 단위 다른 소시지 + 올림
  await addMenu(A, 'm3_breakfast', ['ck5', 'ck14', 'ck16']);
  check('장보기 버튼 활성(레시피 메뉴 있음)', !(await A.locator('[data-action="shop-create"]').isDisabled()));
  await A.click('[data-action="shop-create"]'); await settle();
  let shop = shopOf(A_, 't2');
  check('3-1 장보기 목록 만들기 → 같은 공간 checklists에 kind shopping·제목 "장보기"·tripId', shop.length === 1 && shop[0].title === '장보기', shop.map(s => s.title));
  shop = shop[0] || { items: [] };
  const q = l => (item(shop, l) || {}).qtyText;
  check('3-2 양: 2인 기준 × 4명 → 2배(삼겹살 800g, 상추 300g, 신김치 600g)', q('삼겹살') === '800g' && q('상추') === '300g' && q('신김치') === '600g', [q('삼겹살'), q('상추'), q('신김치')]);
  check('3-2 끼니별 인원·합산: 두부 = 김치찌개(4명) 1모 + 된장찌개(2명) 0.5모 = 1.5모', q('두부') === '1.5모', q('두부'));
  check('3-2 단위가 다르면 나란히: 소시지 "400g + 4개"', q('소시지') === '400g + 4개', q('소시지'));
  check('3-2 올림: 초콜릿칩 30g×2 = 60g → 100g(50 단위), 바나나 4개', q('초콜릿칩') === '100g' && q('바나나') === '4개', [q('초콜릿칩'), q('바나나')]);
  check('3-2 양 없는 재료는 "적당량"', q('소금') === '적당량' && q('쌈장') === '적당량');
  check('1-3 항목 필드: src meal·key·uses, 분류 = cat, 집에 있는 재료는 "집에서 챙길 것"', (item(shop, '돼지고기') || {}).src === 'meal' && item(shop, '돼지고기').key === '돼지고기' && same(item(shop, '대파').uses, ['김치찌개'])
    && item(shop, '삼겹살').group === '고기·해산물' && item(shop, '두부').group === '가공·면·유제품' && item(shop, '소금').group === '집에서 챙길 것' && item(shop, '소금').home === true && item(shop, '쌈장').group === '양념·소스');
  check('직접 입력 메뉴(라면)는 재료 없음', !(shop.items || []).some(i => /라면/.test(i.label)));
  check('3-1 요약 줄에 "장보기 0/n · 열기"', new RegExp('장보기\\s*0/' + shop.items.length + '\\s*· 열기').test(await A.locator('[data-action="shop-open"]').innerText()), await A.locator('[data-action="shop-open"]').innerText());

  // ================= 3. Checklist의 장보기 목록 =================
  await A.click('[data-action="shop-open"]'); await settle();
  check('3-1 열기 → 그 일정의 Checklist 화면(일정 패널) + 장보기 목록', (await A.locator('#view-title').innerText()) === 'Checklist' && (await A.locator('.trip-panel .shop-list').count()) === 1
    && (await A.locator('.trip-chip.active:has-text("2박 홍천")').count()) === 1);
  const shopList = A.locator('.shop-list');
  const srow = (list, label) => list.locator('.check-row').filter({ hasText: new RegExp('^\\s*' + label + '(\\s|$)') });
  const rowLabels = await shopList.locator('.check-row .label').evaluateAll(els => els.map(e => e.firstChild.textContent.trim()));
  check('O-1 장보기는 소분류로 나누지 않음(소분류 제목·+ 없음), 집에서 챙길 것은 맨 아래 + "집에 있음"', (await shopList.locator('.cl-subgroup-head, [data-action="cl-group-add"]').count()) === 0
    && rowLabels.indexOf('소금') > rowLabels.indexOf('초콜릿칩') && rowLabels.indexOf('소금') > rowLabels.indexOf('삼겹살') && /집에 있음/.test(await srow(shopList, '소금').innerText()) && !/집에 있음/.test(await srow(shopList, '삼겹살').innerText()), rowLabels);
  const pork = srow(shopList, '삼겹살');
  check('O-2 항목 줄: 양(개수·중량) 표시 없음, 아래 쓰이는 메뉴, 장바구니 아이콘·안내', (await shopList.locator('.shop-qty').count()) === 0 && !/800g/.test(await pork.innerText()) && /삼겹살 구이/.test(await pork.locator('.shop-uses').innerText())
    && (await shopList.locator('h3 .shop-ico').count()) === 1 && /식단에서 자동으로 만든 목록/.test(await shopList.locator('.shop-note').innerText()));
  check('3-3 체크 버튼 이름: "샀어요"/"안 사요"(집에 있는 건 "챙겼어요")', (await pork.locator('[data-val="packed"]').getAttribute('aria-label')).includes('샀어요') && (await pork.locator('[data-val="skip"]').getAttribute('aria-label')).includes('안 사요')
    && (await srow(shopList, '소금').locator('[data-val="packed"]').getAttribute('aria-label')).includes('챙겼어요'));
  const listMenu = await shopList.locator('h3 .more-menu').evaluate(m => [...m.querySelectorAll('.more-item')].map(b => b.dataset.action).join(','));
  check('3-3 장보기 목록 ⋯: 템플릿으로 저장·장비에서 불러오기 없음', !/cl-save-template|cl-gear-import/.test(listMenu) && /cl-del-list/.test(listMenu), listMenu);
  const panelProg = async () => (await A.locator('.trip-panel .trip-progress-text').innerText());
  const before = await panelProg();
  await pork.locator('[data-val="packed"]').click(); await settle();
  check('1-3 일정 진행률에 장보기도 포함', (await panelProg()) !== before && /준비 1\//.test(await panelProg()), [before, await panelProg()]);
  await srow(shopList, '대파').locator('[data-val="packed"]').click(); await settle();
  check('O-2 항목 ⋯에 "양 고치기" 없음', (await shopList.locator('[data-action="shop-qty"]').count()) === 0);
  await menuClick(A, srow(shopList, '쌈장').locator('[data-action="shop-home"]')); await settle();
  shop = shopOf(A_, 't2')[0];
  check('3-3 집에 있어요(→ 집에서 챙길 것)', item(shop, '쌈장').home === true && item(shop, '쌈장').group === '집에서 챙길 것');
  await shopList.locator('[data-action="cl-add-item"]').click();
  check('O-1 장보기 항목 추가 창에는 소분류 칸 없음', !(await A.locator('#cli-group').isVisible()));
  await A.fill('#cli-label', '얼음'); await A.click('[data-action="cl-add-item-save"]'); await settle();
  check('직접 추가 항목(src 없음)', !!item(shopOf(A_, 't2')[0], '얼음') && !item(shopOf(A_, 't2')[0], '얼음').src);
  check('4-1 일정 패널 진행 줄 옆 "식단 n/m"', /식단\s*3\/7/.test(await A.locator('.trip-panel .tp-meal-link').innerText()), await A.locator('.trip-panel .tp-meal-link').innerText());
  await A.click('.trip-panel .tp-meal-link'); await settle();
  check('4-1 누르면 Cooking 식단표가 그 일정으로', (await A.locator('#view-title').innerText()) === 'Cooking' && (await A.locator('.cook-trip-chip.active:has-text("2박 홍천")').count()) === 1);

  // ================= 4. 식단 변경 → 자동 맞춤 =================
  await menuClick(A, row(A, 'm1_dinner').locator('.dish-chip:has-text("김치찌개") [data-action="dish-del"]')); await settle();
  shop = shopOf(A_, 't2')[0];
  check('3-2 빠진 재료: 아직 안 산 건 삭제(신김치·돼지고기)', !item(shop, '신김치') && !item(shop, '돼지고기'));
  check('3-2 이미 체크한 건 남기고 "식단에서 빠짐"(대파)', item(shop, '대파') && item(shop, '대파').gone === true && item(shop, '대파').status === 'packed');
  check('3-2 체크·집에 있음·직접 추가 유지', item(shop, '삼겹살').status === 'packed' && item(shop, '쌈장').group === '집에서 챙길 것' && item(shop, '쌈장').home && !!item(shop, '얼음'));
  check('3-2 uses 갱신(두부는 된장찌개만)', same(item(shop, '두부').uses, ['된장찌개']), item(shop, '두부').uses);
  await A.click('#toast [data-action="undo-delete"]'); await settle();
  shop = shopOf(A_, 't2')[0];
  check('2-3 빼기 되돌리기 → 김치찌개 원래 자리 + 장보기 재료 다시(신김치 pending, 대파 빠짐 표시 해제)', same(meal(A_, 't2', 'm1_dinner').dishes.map(d => d.name), ['라면', '삼겹살 구이', '김치찌개'])
    && item(shop, '신김치') && item(shop, '신김치').status === 'pending' && !item(shop, '대파').gone && item(shop, '대파').status === 'packed');
  // 옮기기
  await menuClick(A, row(A, 'm1_dinner').locator('.dish-chip:has-text("라면") [data-action="dish-move"]'));
  await A.click('[data-action="dish-move-go"][data-to="m2_dinner"]'); await settle();
  check('2-3 다른 끼니로 옮기기', same(meal(A_, 't2', 'm1_dinner').dishes.map(d => d.name), ['삼겹살 구이', '김치찌개']) && same(meal(A_, 't2', 'm2_dinner').dishes.map(d => d.name), ['라면']));
  // 끼니 추가
  await A.locator('.meal-day').nth(1).locator('[data-action="meal-extra-add"]').click();
  await A.click('[data-action="em-preset"][data-val="야식"]'); await A.click('[data-action="em-save"]'); await settle();
  const extra = (trip(A_, 't2').meals || []).find(m => m.slot === 'extra');
  check('2-3 + 끼니 추가(야식) → slot extra + label', extra && extra.day === 2 && extra.label === '야식' && (await A.locator('.meal-day').nth(1).locator('.meal-name:has-text("야식")').count()) === 1, extra);
  // 다 먹었어요
  await menuClick(A, row(A, 'm1_dinner').locator('[data-action="meal-done"]')); await settle();
  shop = shopOf(A_, 't2')[0];
  check('2-3 다 먹었어요 → done(흐리게 접힘), 장보기에서 그 재료는 빠짐(체크한 삼겹살은 "빠짐" 표시, 신김치 삭제)', meal(A_, 't2', 'm1_dinner').done === true && (await row(A, 'm1_dinner').evaluate(e => e.classList.contains('done'))) && (await row(A, 'm1_dinner').locator('.dish-chip').count()) === 0
    && item(shop, '삼겹살').gone === true && !item(shop, '신김치'));
  await menuClick(A, row(A, 'm1_dinner').locator('[data-action="meal-done"]')); await settle();
  check('2-3 다시 누르면 해제', !meal(A_, 't2', 'm1_dinner').done && !item(shopOf(A_, 't2')[0], '삼겹살').gone);

  // 목록 삭제 → 다시 만들지 않음
  await nav(A, 'checklist'); await settle();
  await menuClick(A, A.locator('.shop-list [data-action="cl-del-list"]')); await confirmYes(A); await settle();
  check('(준비) 장보기 목록 삭제', shopOf(A_, 't2').length === 0);
  await nav(A, 'cooking'); await settle();
  await addMenu(A, 'm2_breakfast', ['ck8']);
  check('3-2 목록을 지우면 식단이 바뀌어도 다시 만들지 않고 "장보기 목록 만들기"가 다시 보임', shopOf(A_, 't2').length === 0 && (await A.locator('[data-action="shop-create"]').count()) === 1);

  // ================= 5. 날짜 밖 끼니 =================
  await put(A_ + 'trips/t0', { ...trip(A_, 't0'), meals: [{ id: 'm3_dinner', day: 3, slot: 'dinner', dishes: [{ id: 'dz', name: '바비큐' }] }] });
  await pickTrip(A, '당일 피크닉');
  check('1-2 일정 범위를 벗어난 끼니는 지우지 않고 "날짜 밖" 묶음', (await A.locator('.meal-outside .dish-chip:has-text("바비큐")').count()) === 1);
  await menuClick(A, A.locator('.meal-outside [data-action="meal-move"]'));
  await A.click('[data-action="meal-move-go"][data-day="1"]'); await settle();
  check('1-2 날짜 밖 끼니를 날짜 안으로 옮기기(같은 끼니에 합침)', (await A.locator('.meal-outside').count()) === 0 && same(meal(A_, 't0', 'm1_dinner').dishes.map(d => d.name), ['바비큐']));

  // ================= 6. 그룹 일정 =================
  const B = await phone(UB, { mobile: true });
  await nav(B, 'cooking'); await settle();
  check('그룹 B: Cooking 기본 = 가장 가까운 그룹 일정', (await B.locator('.cook-trip-chip.active:has-text("팸 캠핑")').count()) === 1);
  check('그룹 기본 인원 = 참가 멤버 수(2명)', /기본 2명/.test(await B.locator('.ms-base').innerText()));
  check('A는 지금 개인 공간(Checklist 공간 = 내 공간)', (await A.evaluate(() => state.space)) === 'me');
  await pickTrip(A, '팸 캠핑');
  await addMenu(A, 'm1_dinner', ['ck1']);
  check('2-2 개인 공간을 보고 있어도 그룹 일정 식단은 그룹 문서에 저장', (meal(G_, 'gt', 'm1_dinner') || { dishes: [] }).dishes.length === 1 && !server[A_ + 'trips/gt']);
  await B.waitForSelector('.meal-row[data-meal-row="m1_dinner"] .dish-chip:has-text("삼겹살")', { timeout: 3000 }).catch(() => {});
  check('그룹: A가 넣은 메뉴가 B에게 실시간으로', (await row(B, 'm1_dinner').locator('.dish-chip:has-text("삼겹살")').count()) === 1);
  await menuClick(B, row(B, 'm1_dinner').locator('.dish-chip:has-text("삼겹살") [data-action="dish-assign"]'));
  await B.click(`[data-action="dish-assign-set"][data-uid="${UB.uid}"]`); await settle();
  check('2-3 메뉴 담당자 지정(그룹 일정만)', meal(G_, 'gt', 'm1_dinner').dishes[0].assigneeUid === UB.uid);
  // 동시에 다른 끼니
  await Promise.all([addMenu(A, 'm1_lunch', [], '김밥'), addMenu(B, 'm2_breakfast', [], '누룽지')]);
  await settle(); await settle();
  const gm = (trip(G_, 'gt').meals || []).map(m => m.id + ':' + (m.dishes || []).map(d => d.name).join('/')).sort();
  check('1-2 두 사람이 다른 끼니를 동시에 고쳐도 둘 다 남음', gm.includes('m1_lunch:김밥') && gm.includes('m2_breakfast:누룽지') && gm.includes('m1_dinner:삼겹살 구이'), gm);
  await B.click('[data-action="shop-create"]'); await settle();
  const gshop = shopOf(G_, 'gt')[0] || { items: [] };
  check('3-2 그룹: 메뉴 담당자 → 재료 담당자 기본값(삼겹살·상추 = 밥), addedBy', item(gshop, '삼겹살') && item(gshop, '삼겹살').assigneeUid === UB.uid && item(gshop, '상추').assigneeUid === UB.uid && item(gshop, '삼겹살').addedBy === UB.uid, gshop.items);
  await A.waitForSelector('[data-action="shop-open"]', { timeout: 3000 }).catch(() => {});
  check('그룹: 장보기 목록이 A의 식단표에도 "열기"로', (await A.locator('[data-action="shop-open"]').count()) === 1);
  // B가 체크 → A가 식단 바꿔도 B 체크 유지
  await B.click('[data-action="shop-open"]'); await settle();
  await srow(B.locator('.shop-list'), '상추').locator('[data-val="packed"]').click(); await settle();
  await addMenu(A, 'm1_dinner', ['ck2']);
  const gshop2 = shopOf(G_, 'gt')[0];
  check('3-2 다른 멤버가 방금 한 체크를 덮어쓰지 않음 + 새 재료 추가(중복 없음)', item(gshop2, '상추').status === 'packed' && !!item(gshop2, '양파')
    && gshop2.items.filter(i => i.key === '삼겹살').length === 1 && new Set(gshop2.items.map(i => i.key)).size === gshop2.items.length, gshop2.items.map(i => i.label + ':' + i.status));
  check('3-2 담당자가 섞인 재료는 비움(돼지고기 = 담당 없는 꼬치구이)', !item(gshop2, '돼지고기').assigneeUid);

  // ================= 7. Home · 지난 일정 =================
  await nav(A, 'home'); await settle();
  check('4-2 Home 다음 캠핑 카드에 " · 식단 n/m끼"', /식단 3\/4끼/.test(await A.locator('.next-trip-card').innerText()), await A.locator('.next-trip-card').innerText());
  await nav(A, 'checklist'); await settle();
  await A.locator('#nav [data-nav="pastTrips"]').click(); await settle();
  const pc = A.locator('.past-trip-card:has-text("지난 춘천")');
  check('4-3 지난 일정 카드에 "해먹은 메뉴 2개"', /해먹은 메뉴 2개/.test(await pc.innerText()));
  await pc.locator('[data-action="cook-open-trip"]').click(); await settle();
  check('4-3 누르면 식단표(지난 일정 펼쳐서 선택)', (await A.locator('#view-title').innerText()) === 'Cooking' && (await A.locator('.cook-trip-chip.active:has-text("지난 춘천")').count()) === 1
    && (await A.locator('.dish-chip:has-text("삼겹살")').count()) === 1);
  check('4-2 식단 없는 일정의 Home 글은 그대로(식단 문구 없음)', await (async () => {
    const r = await A.evaluate(() => { const t = { title: 'x', startDate: '2099-01-01' }; return mealStats(t).dishes; }); return r === 0;
  })());

  // ================= 8. 메뉴 직접 입력(이름 + 재료) =================
  await nav(A, 'cooking'); await settle();
  await pickTrip(A, '1박 가평');
  await row(A, 'm2_lunch').locator('[data-action="meal-add-dish"]').click();
  await A.waitForSelector('#mp-custom', { timeout: 3000 });
  check('N-3 메뉴 넣기 창: 음식 이름·재료 입력칸, 레시피는 접혀 있음', (await A.locator('#mp-ings').count()) === 1 && !(await A.locator('#mp-list').isVisible()));
  await A.click('[data-action="mp-go"]'); await settle();
  check('N-3 아무것도 안 넣으면 안내만(저장 안 함)', !meal(A_, 't1', 'm2_lunch') && (await A.locator('#mp-custom').count()) === 1);
  await A.fill('#mp-ings', '햄 200g'); await A.click('[data-action="mp-go"]'); await settle();
  check('N-3 재료만 있고 이름이 없으면 저장 안 함', !meal(A_, 't1', 'm2_lunch'));
  await A.fill('#mp-custom', '부대찌개'); await A.fill('#mp-ings', '햄 200g, 라면사리 2개, 김치, 대파 1.5대'); await A.click('[data-action="mp-go"]'); await settle();
  let bd = (meal(A_, 't1', 'm2_lunch') || { dishes: [] }).dishes[0] || {};
  check('N-3·O-2 직접 입력: 메뉴 하나 + 재료(양은 이름에 그대로) 저장', bd.name === '부대찌개' && !bd.recipeId
    && same(bd.ingredients, [{ name: '햄 200g' }, { name: '라면사리 2개' }, { name: '김치' }, { name: '대파 1.5대' }]), bd);
  await row(A, 'm2_lunch').locator('.dish-chip:has-text("부대찌개") [data-action="dish-open"]').click(); await settle();
  const drText = await row(A, 'm2_lunch').locator('.dish-recipe').innerText();
  check('N-3 메뉴를 누르면 적은 재료가 보임(적당량 같은 양 칸 없음)', /햄 200g/.test(drText) && /김치/.test(drText) && !/적당량/.test(drText), drText);
  check('N-3 재료가 있는 직접 입력 메뉴만으로도 장보기 목록 만들기 가능', !(await A.locator('[data-action="shop-create"]').isDisabled()));
  await A.click('[data-action="shop-create"]'); await settle();
  let s1 = shopOf(A_, 't1')[0] || { items: [] };
  check('N-3 장보기: 직접 적은 재료가 이름 그대로 들어감', item(s1, '햄 200g') && item(s1, '김치') && item(s1, '대파 1.5대')
    && same(item(s1, '햄 200g').uses, ['부대찌개']) && item(s1, '햄 200g').src === 'meal', s1.items.map(i => i.label + ':' + i.qtyText + ':' + i.group));
  await menuClick(A, row(A, 'm2_lunch').locator('[data-action="dish-edit"]'));
  await A.waitForSelector('#de-ings', { timeout: 3000 });
  check('N-3 이름·재료 고치기 창에 지금 재료가 채워짐', (await A.inputValue('#de-ings')) === '햄 200g, 라면사리 2개, 김치, 대파 1.5대', await A.inputValue('#de-ings'));
  await A.fill('#de-name', '부대찌개(큰 냄비)'); await A.fill('#de-ings', '햄 300g, 라면사리 2개');
  await A.click('[data-action="dish-edit-save"]'); await settle(); await settle();
  bd = (meal(A_, 't1', 'm2_lunch') || { dishes: [] }).dishes[0] || {};
  s1 = shopOf(A_, 't1')[0] || { items: [] };
  check('N-3 고치기 → 메뉴 이름·재료 저장, 장보기도 맞춤(바뀐 재료 추가, 빠진 재료는 지움)', bd.name === '부대찌개(큰 냄비)' && bd.ingredients.length === 2
    && item(s1, '햄 300g') && !item(s1, '햄 200g') && !item(s1, '김치') && same(item(s1, '햄 300g').uses, ['부대찌개(큰 냄비)']), s1.items.map(i => i.label + ':' + i.qtyText));
  // 이름만 쉼표로 여러 개(예전처럼)
  await addMenu(A, 'm1_lunch', [], '컵라면, 김밥');
  check('N-3 재료 없이 이름만 쉼표로 적으면 메뉴 여러 개', same((meal(A_, 't1', 'm1_lunch') || { dishes: [] }).dishes.map(d => d.name), ['컵라면', '김밥']));
  check('O-2 parseIngredients: 이름 그대로(양 포함), 빈 칸·같은 이름은 하나', await A.evaluate(() => JSON.stringify(parseIngredients('양파, 양파 2개,  , 양파, 우유 1L'))) === JSON.stringify([{ name: '양파' }, { name: '양파 2개' }, { name: '우유 1L' }]),
    await A.evaluate(() => JSON.stringify(parseIngredients('양파, 양파 2개,  , 양파, 우유 1L'))));
  check('O-2 예전에 양을 따로 저장한 재료도 이름에 붙여서 보임', await A.evaluate(() => JSON.stringify(dishIngs({ ingredients: [{ name: '햄', qty: 200, unit: 'g' }, { name: '김치' }] }))) === JSON.stringify([{ name: '햄 200g' }, { name: '김치' }]));

  // ================= 9. 일정 삭제 되돌리기 · 백업 =================
  const t1Before = JSON.parse(JSON.stringify(trip(A_, 't1')));
  await nav(A, 'checklist'); await settle();
  await A.locator('.trip-chip:has-text("1박 가평")').click(); await settle();
  await menuClick(A, A.locator('.trip-card [data-action="trip-del"]')); await confirmYes(A); await settle();
  check('(준비) 일정 삭제', !server[A_ + 'trips/t1']);
  await A.click('#toast [data-action="undo-delete"]'); await settle();
  check('4-4 일정 삭제 → 되돌리기 하면 meals도 그대로', same(trip(A_, 't1').meals, t1Before.meals));
  // 장보기 목록이 있는 일정 삭제 → 목록은 남고 tripId만 해제, kind 유지
  await nav(A, 'cooking'); await settle(); await pickTrip(A, '2박 홍천');
  await A.click('[data-action="shop-create"]'); await settle();
  const sid = (shopOf(A_, 't2')[0] || {}).id;
  await nav(A, 'checklist'); await settle();
  await A.locator('.trip-chip:has-text("2박 홍천")').click(); await settle();
  await menuClick(A, A.locator('.trip-card [data-action="trip-del"]')); await confirmYes(A); await settle();
  const orphan = server[A_ + 'checklists/' + sid] || {};
  check('4-4 일정을 지워도 장보기 목록은 남고 tripId만 해제(kind 그대로)', !!sid && orphan.kind === 'shopping' && !orphan.tripId, orphan);
  await A.click('[data-action="trip-pick"][data-trip="all"]').catch(() => {}); await settle();
  check('4-4 연결이 풀린 장보기 목록: 자동 맞춤 멈춤 안내', /자동으로 맞추지 않아요/.test(await A.locator(`[data-cl="${sid}"] .shop-note`).innerText()));
  await nav(A, 'settings'); await settle();
  await A.click('[data-action="backup-export"]');
  const backup = JSON.parse(await A.inputValue('#backup-text'));
  await A.click('[data-action="modal-close"]');
  const bt = (backup.trips || []).find(t => t.id === 't1');
  check('4-5 개인 백업에 meals·mealServings·장보기 필드 포함', bt && same(bt.meals, trip(A_, 't1').meals) && (backup.checklists || []).some(l => l.kind === 'shopping' && l.items.some(i => i.src === 'meal' && i.qtyText)), { trip: !!bt });
  // 예전 형식 백업(cookingChecks 포함, meals 없음) 가져오기
  const oldBackup = { app: 'campbase', version: 1, exportedAt: 'x', campingLogs: [], gear: [], checklists: [{ id: 'oc', title: '예전 리스트', items: [] }], cookingChecks: { ck1: { checked: [0, 1] } }, settings: {} };
  await A.click('[data-action="backup-import"]');
  await A.fill('#backup-text-in', JSON.stringify(oldBackup));
  await A.click('[data-action="backup-import-go"]');
  await confirmYes(A); await settle(); await settle();
  check('1-4·하위 호환: 예전 백업(cookingChecks) 가져오기 정상, 데이터는 그대로 저장', !!server[A_ + 'checklists/oc'] && same(server[A_ + 'cookingChecks/ck1'], { checked: [0, 1] }));
  await nav(A, 'cooking'); await settle();
  check('하위 호환: 일정·식단 보기 오류 없음', (await A.locator('.meal-summary, .meal-empty').count()) >= 1);

  // ================= 10. 일정이 하나도 없을 때 =================
  const C = await phone(UC, { mobile: true });
  await nav(C, 'cooking'); await settle();
  check('2-2 일정이 없으면 "캠핑 일정을 만들면 식단을 짤 수 있어요" + 일정 만들기', /캠핑 일정을 만들면 식단을 짤 수 있어요/.test(await C.locator('.meal-empty').innerText()) && (await C.locator('.meal-empty [data-action="trip-new"]').count()) === 1);
  await C.click('.meal-empty [data-action="trip-new"]'); await settle();
  check('일정 만들기 안내 → 일정 만들기 창', (await C.locator('#tf-title').count()) === 1);
  await C.click('[data-action="modal-close"]'); await settle();

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
