// 화면 규칙 테스트 (가짜 Firestore/Auth):
//  모바일(390px) 하단 탭바로 6개 탭 이동, 본문 맨 아래가 탭바에 가리지 않음, 키보드가 올라오면 탭바 숨김, 데스크톱은 사이드바,
//  ⋯ 메뉴(열기·바깥 클릭/Esc 닫기·화살표 이동·위험 항목 맨 아래), 모달(X·Esc 닫기, 입력 모달 배경 클릭 무시, 확인 모달 배경 클릭 닫기,
//  첫 입력칸 초점, Tab 가두기, 닫힌 뒤 초점 복귀, 동작 줄이기), 키보드 초점 표시, 강조색(앰버)·글자 대비(밝은/어두운 모드).
// 실행: node tests/ui.test.js   (저장소 루트에서, playwright 필요)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-firestore.js'), 'utf8');
const SITE = fs.mkdtempSync(path.join(os.tmpdir(), 'campbase-ui-'));
fs.cpSync(path.join(ROOT, 'docs'), SITE, { recursive: true });
fs.writeFileSync(path.join(SITE, 'firebase-config.js'), 'window.FIREBASE_CONFIG = { apiKey: "test-key", authDomain: "t.firebaseapp.com", projectId: "campbase-test", appId: "1:1:web:1" };\n');
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const PORT = 8774;

const UA = { uid: 'uidAlice', displayName: '앨리스', email: 'alice@example.com', photoURL: '' };
const results = [];
const check = (name, ok, extra) => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function seed() {
  const s = {}, A = 'users/uidAlice/';
  for (let i = 1; i <= 8; i++) s[A + 'campingLogs/c' + i] = { name: '캠핑장 ' + i, date: '2026-0' + (i % 9 + 1) + '-01', region: i % 2 ? '홍천' : '가평', siteType: '데크', rating: i % 5, notes: '메모 '.repeat(20) };
  s[A + 'gear/g1'] = { name: '스텔스 5 텐트', brand: 'Snow Peak', category: '텐트', price: 0, weight: 0, date: '' };
  s[A + 'checklists/cl1'] = { title: '기본 준비물', items: [{ id: 'i1', label: '텐트', status: 'packed', group: '텐트' }, { id: 'i2', label: '랜턴', status: 'pending', group: '조명' }] };
  s['groups/grpFam'] = { name: '캠핑팸', ownerUid: 'uidAlice', memberUids: ['uidAlice'], createdAt: '1', gearCategories: ['기타'], members: { uidAlice: { name: '앨리스', photoURL: '', role: 'owner' } } };
  return s;
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT), '-d', SITE], { stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
  const pages = [];
  async function phone(opts = {}) {
    const server = seed();
    const ctx = await browser.newContext({ viewport: opts.mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, colorScheme: opts.scheme || 'light', reducedMotion: opts.reducedMotion || 'no-preference' });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));
    await ctx.exposeFunction('__fsDump', () => JSON.parse(JSON.stringify(server)));
    await ctx.exposeFunction('__fsWrite', async (p, d) => { if (d === null) delete server[p]; else server[p] = d; });
    await ctx.addInitScript(u => { window.__fakePopupUser = u; }, UA);
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
  const isFocused = (p, sel) => p.evaluate(s => !!document.activeElement && document.activeElement.matches(s), sel);
  const modalOpen = p => p.evaluate(() => !!document.getElementById('modal-backdrop'));

  // ================= 1. 모바일 하단 탭바 =================
  const M = await phone({ mobile: true });
  const bar = M.locator('#mobile-tabbar');
  check('390px: 하단 탭바 보이고 사이드바 숨김', await bar.isVisible() && !(await M.locator('#sidebar').isVisible()));
  const box = await bar.boundingBox();
  check('탭바는 화면 맨 아래에 고정', box && Math.abs(box.y + box.height - 844) <= 1, box);
  check('6개 탭이 스크롤 없이 한 줄에 모두 보임', await M.evaluate(() => {
    const items = [...document.querySelectorAll('#mobile-tabbar .mnav-item')];
    const bar = document.getElementById('mobile-tabbar');
    const top = items[0].getBoundingClientRect().top;
    return items.length === 6 && bar.scrollWidth <= bar.clientWidth && items.every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && Math.abs(r.top - top) < 1 && r.width >= 40 && r.height >= 40; });
  }));
  check('페이지 가로 스크롤 없음', await M.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  const titles = {};
  for (const tab of ['camping', 'gear', 'checklist', 'cooking', 'settings', 'home']) {
    await M.click(`#mobile-tabbar [data-nav="${tab}"]`);
    titles[tab] = (await M.locator('#view-title').innerText()) + ((await M.locator(`#mobile-tabbar [data-nav="${tab}"].active[aria-current="page"]`).count()) ? '✓' : '');
  }
  check('하단 탭바로 6개 탭 이동 + 지금 탭 강조(aria-current)', JSON.stringify(titles) === JSON.stringify({ camping: 'Camping✓', gear: 'Gear✓', checklist: 'Checklist✓', cooking: 'Cooking✓', settings: 'Settings✓', home: 'Home✓' }), titles);
  check('연결 상태 알약은 위쪽에 그대로', await M.locator('#db-status-top').isVisible() && (await M.locator('#db-status-top').boundingBox()).y < 100);
  // 본문 맨 아래 버튼이 탭바에 가리지 않음
  async function bottomNotCovered(tab, sel) {
    await M.click(`#mobile-tabbar [data-nav="${tab}"]`);
    await M.evaluate(() => { const m = document.getElementById('main'); m.scrollTop = m.scrollHeight; });
    await sleep(100);
    return M.evaluate(s => {
      const els = [...document.querySelectorAll(s)]; const el = els[els.length - 1];
      const r = el.getBoundingClientRect(); const barTop = document.getElementById('mobile-tabbar').getBoundingClientRect().top;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { ok: r.bottom <= barTop && !!hit && (hit === el || el.contains(hit)), bottom: Math.round(r.bottom), barTop: Math.round(barTop) };
    }, sel);
  }
  const s1 = await bottomNotCovered('settings', '[data-action="backup-import"]');
  check('Settings 맨 아래 버튼이 탭바에 가리지 않음(눌림)', s1.ok, s1);
  const s2 = await bottomNotCovered('camping', '.list-row [data-action="camp-edit"]');
  check('Camping 긴 목록의 맨 아래 버튼도 탭바에 가리지 않음', s2.ok, s2);
  // 키보드가 올라오면 탭바 숨김
  await M.click('#mobile-tabbar [data-nav="camping"]');
  await M.click('[data-action="camp-new"]');
  await M.waitForSelector('#cf-name');
  await sleep(100);
  check('입력칸에 초점 → 탭바 숨김(키보드가 가리지 않게)', await M.evaluate(() => document.body.classList.contains('kbd-open')) && !(await bar.isVisible()));
  await M.keyboard.press('Escape');
  await sleep(150);
  check('입력이 끝나면 탭바 다시 보임', await bar.isVisible());

  // ================= 2. 데스크톱 =================
  const D = await phone();
  check('1280px: 왼쪽 사이드바 그대로, 하단 탭바 없음', await D.locator('#sidebar').isVisible() && !(await D.locator('#mobile-tabbar').isVisible()));

  // ================= 3. ⋯ 메뉴 =================
  await D.click('[data-nav="checklist"]');
  const more = D.locator('.checklist-group:has-text("기본 준비물") > h3 .more');
  const moreBtn = more.locator('.more-btn');
  const menu = more.locator('.more-menu');
  check('리스트 헤더에는 "항목 추가" 하나만 보이고 나머지는 ⋯ 메뉴', await D.locator('.checklist-group:has-text("기본 준비물") > h3 [data-action="cl-add-item"]').isVisible()
    && !(await menu.isVisible()) && (await menu.locator('[data-action="cl-list-rename"], [data-action="cl-list-reset"], [data-action="cl-save-template"], [data-action="cl-send"], [data-action="cl-del-list"]').count()) === 5);
  check('아이콘만 있는 ⋯ 버튼에 aria-label, 최소 40×40', await moreBtn.getAttribute('aria-label') !== null && await moreBtn.evaluate(el => { const r = el.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; }));
  check('앱 전체: 아이콘만 있는 버튼에는 모두 aria-label', await D.evaluate(() => [...document.querySelectorAll('button.icon-btn')].every(b => b.getAttribute('aria-label'))));
  await moreBtn.click();
  check('⋯ 누르면 메뉴 열림 + aria-expanded + 첫 항목에 초점', await menu.isVisible() && (await moreBtn.getAttribute('aria-expanded')) === 'true' && await isFocused(D, '.more-item[data-action="cl-list-rename"]'));
  check('위험한 항목(삭제)은 빨간색으로 맨 아래', await menu.evaluate(m => { const items = [...m.querySelectorAll('.more-item')]; const last = items[items.length - 1]; return last.dataset.action === 'cl-del-list' && last.classList.contains('danger') && items.filter(i => i.classList.contains('danger')).length === 1; }));
  await D.keyboard.press('ArrowDown');
  const second = await D.evaluate(() => document.activeElement.dataset.action);
  await D.keyboard.press('ArrowUp'); await D.keyboard.press('ArrowUp');
  const wrapped = await D.evaluate(() => document.activeElement.dataset.action);
  await D.keyboard.press('Home');
  const home = await D.evaluate(() => document.activeElement.dataset.action);
  check('키보드: 화살표로 항목 이동(끝에서 처음으로 돌아감), Home', second === 'cl-list-reset' && wrapped === 'cl-del-list' && home === 'cl-list-rename', { second, wrapped, home });
  await D.keyboard.press('Escape');
  check('Esc로 닫힘 + ⋯ 버튼으로 초점 복귀', !(await menu.isVisible()) && (await moreBtn.getAttribute('aria-expanded')) === 'false' && await moreBtn.evaluate(el => el === document.activeElement));
  await moreBtn.click();
  await D.mouse.click(5, 880);
  check('바깥을 누르면 닫힘', !(await menu.isVisible()));
  const lowerMenu = D.locator('.check-row:has-text("랜턴") .more');
  await lowerMenu.locator('.more-btn').click();
  await moreBtn.click();
  check('다른 ⋯을 열면 앞의 메뉴는 닫힘(하나만 열림)', await menu.isVisible() && !(await lowerMenu.locator('.more-menu').isVisible()) && (await D.locator('.more-menu:not([hidden])').count()) === 1);
  await D.keyboard.press('Escape');
  // 키보드만으로 메뉴 항목 실행(Enter) → 같은 data-action 동작
  await moreBtn.focus();
  await D.keyboard.press('ArrowDown');
  await D.keyboard.press('End');
  await D.keyboard.press('Enter');
  await D.waitForSelector('[data-action="confirm-yes"]', { timeout: 2000 }).catch(() => {});
  check('Enter로 메뉴 항목 실행(리스트 삭제 확인 창) + 메뉴 닫힘', /전체를 삭제할까요/.test(await D.locator('#modal-root').innerText()) && (await D.locator('.more-menu:not([hidden])').count()) === 0);

  // ================= 4. 모달 =================
  const x = D.locator('#modal-root .modal-x');
  check('모든 모달 오른쪽 위 닫기(X) + aria-label', (await x.count()) === 1 && (await x.getAttribute('aria-label')) === '닫기' && await D.evaluate(() => {
    const m = document.querySelector('#modal-root .modal').getBoundingClientRect(), b = document.querySelector('#modal-root .modal-x').getBoundingClientRect();
    return b.right > m.right - 30 && b.top < m.top + 30;
  }));
  await D.mouse.click(5, 5);   // 확인만 하는 모달: 배경을 누르면 닫힘
  await sleep(250);
  check('확인 모달은 배경을 누르면 닫힘(삭제 안 됨)', !(await modalOpen(D)) && (await D.locator('.checklist-group:has-text("기본 준비물")').count()) === 1);
  check('메뉴 항목으로 연 모달이 닫히면 그 줄의 ⋯ 버튼으로 초점 복귀', await moreBtn.evaluate(el => el === document.activeElement));
  await D.click('[data-nav="camping"]');
  const newBtn = D.locator('[data-action="camp-new"]');
  await newBtn.click();
  await D.waitForSelector('#cf-name');
  check('열리면 첫 입력칸으로 초점', await isFocused(D, '#cf-name'));
  await D.fill('#cf-name', '입력 중');
  await D.mouse.click(5, 5);
  await sleep(250);
  check('입력칸이 있는 모달은 배경을 눌러도 안 닫힘(입력 유지)', await modalOpen(D) && (await D.inputValue('#cf-name')) === '입력 중');
  // Tab 가두기
  await D.focus('#cf-name');
  await D.keyboard.press('Shift+Tab');
  const fromFirstBack = await D.evaluate(() => !!document.activeElement.closest('#modal-root .modal'));
  for (let i = 0; i < 40; i++) await D.keyboard.press('Tab');
  const stillIn = await D.evaluate(() => !!document.activeElement.closest('#modal-root .modal'));
  check('Tab은 모달 안에서만 돎(앞뒤로)', fromFirstBack && stillIn);
  await D.keyboard.press('Escape');
  await sleep(250);
  check('Esc로 닫힘', !(await modalOpen(D)));
  check('닫히면 연 버튼(기록 추가)으로 초점 복귀', await newBtn.evaluate(el => el === document.activeElement));
  await newBtn.click();
  await D.waitForSelector('#cf-name');
  await x.click();
  await sleep(250);
  check('X로 닫힘 + 초점 복귀', !(await modalOpen(D)) && await newBtn.evaluate(el => el === document.activeElement));
  // 모달에서 모달로(백업 가져오기 → 확인) 바뀌어도 처음 연 버튼으로 돌아감
  await D.click('[data-nav="settings"]');
  const impBtn = D.locator('[data-action="backup-import"]');
  await impBtn.click();
  await D.fill('#backup-text-in', '{"app":"campbase","campingLogs":[]}');
  await D.click('[data-action="backup-import-go"]');
  await D.waitForSelector('[data-action="confirm-yes"]');
  await D.keyboard.press('Escape');
  await sleep(250);
  check('모달 → 확인 모달을 닫아도 처음 연 버튼으로 초점 복귀', await impBtn.evaluate(el => el === document.activeElement));
  // 나타남/사라짐 효과
  await impBtn.click();
  const anim = await D.evaluate(() => getComputedStyle(document.querySelector('#modal-root .modal')).animationName);
  await D.keyboard.press('Escape');
  const ghostDuring = await D.evaluate(() => document.querySelectorAll('#modal-ghost .modal-backdrop.closing').length);
  await sleep(260);
  const ghostAfter = await D.evaluate(() => document.querySelectorAll('#modal-ghost .modal-backdrop').length);
  check('열 때 살짝 커지며 나타나고, 닫힐 때 사라지는 효과(끝나면 정리)', anim === 'cb-pop-in' && ghostDuring === 1 && ghostAfter === 0, { anim, ghostDuring, ghostAfter });
  check('사라지는 중인 모달은 버튼을 찾거나 누를 수 없음', await D.evaluate(() => true) && (await D.locator('#modal-ghost [data-action]').count()) === 0);
  const R = await phone({ reducedMotion: 'reduce' });
  await R.click('[data-nav="camping"]');
  await R.click('[data-action="camp-new"]');
  const ranim = await R.evaluate(() => getComputedStyle(document.querySelector('#modal-root .modal')).animationName);
  await R.keyboard.press('Escape');
  const rghost = await R.evaluate(() => document.querySelectorAll('#modal-ghost .modal-backdrop').length);
  check('"동작 줄이기" 설정이면 효과 없음', ranim === 'none' && rghost === 0, { ranim, rghost });

  // ================= 5. 키보드 초점 표시 =================
  await D.click('[data-nav="gear"]');
  await D.evaluate(() => { const b = document.createElement('button'); b.id = 'probe'; b.className = 'btn'; b.textContent = '테스트'; document.getElementById('main').prepend(b); });
  await D.click('#probe');   // 마우스로 누름
  const mouse = await D.evaluate(() => { const el = document.getElementById('probe'); return { focused: document.activeElement === el, fv: el.matches(':focus-visible'), style: getComputedStyle(el).outlineStyle }; });
  check('마우스로 누르면 초점 테두리 안 보임', mouse.focused && !mouse.fv && mouse.style === 'none', mouse);
  await D.keyboard.press('Tab');
  const kb = await D.evaluate(() => { const el = document.activeElement; const cs = getComputedStyle(el); return { tag: el.tagName, fv: el.matches(':focus-visible'), style: cs.outlineStyle, width: cs.outlineWidth }; });
  check('키보드로 움직이면 초점 테두리(2px 실선) 보임', kb.fv && kb.style === 'solid' && kb.width === '2px', kb);
  await D.evaluate(() => document.getElementById('probe').remove());

  // ================= 6. 강조색(앰버)·대비 =================
  for (const scheme of ['light', 'dark']) {
    const P = await phone({ scheme });
    const info = await P.evaluate(async () => {
      const lum = c => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const bgOf = el => { while (el) { const b = getComputedStyle(el).backgroundColor; if (b && !/rgba\(.*, 0\)|transparent/.test(b)) return b; el = el.parentElement; } return getComputedStyle(document.body).backgroundColor; };
      // color-mix() 배경은 실제 칠해진 색으로 계산되도록 canvas 없이 computed 값 사용(Chromium은 rgb/color()로 돌려줌)
      const toRgb = c => { const cv = document.createElement('canvas').getContext('2d'); cv.fillStyle = '#000'; cv.fillStyle = c; const d = document.createElement('div'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v.startsWith('color(') ? (() => { const n = v.match(/[\d.]+/g).slice(0, 3).map(x => Math.round(Number(x) * 255)); return `rgb(${n.join(',')})`; })() : v; };
      const pairs = {};
      const go = async tab => { document.querySelector(`[data-nav="${tab}"]`).click(); await new Promise(r => setTimeout(r, 200)); };
      const sample = (name, sel) => { const el = document.querySelector(sel); if (!el) return; pairs[name] = Math.round(cr(toRgb(getComputedStyle(el).color), toRgb(bgOf(el))) * 100) / 100; };
      await go('checklist');
      sample('생성 버튼(새 리스트) 글자', '[data-action="cl-new-list"]');
      sample('진행률 태그', '.checklist-group h3 .tag');
      sample('활성 칩', '.seg-btn.active');
      sample('보조 글자(text-dim)', '.section-desc');
      sample('일정 만들기 칩', '[data-action="trip-new"]');
      await go('settings');
      sample('그룹 만들기', '[data-action="group-new"]');
      sample('그룹 역할 태그', '.group-row .tag');
      await go('cooking');
      sample('재료 배지', '.card .tag');
      const accentEls = [...document.querySelectorAll('.btn-accent, .trip-new-chip')].map(e => e.dataset.action);
      await go('checklist');
      accentEls.push(...[...document.querySelectorAll('.btn-accent, .trip-new-chip')].map(e => e.dataset.action));
      await go('gear'); accentEls.push(...[...document.querySelectorAll('.btn-accent')].map(e => e.dataset.action));
      await go('camping'); accentEls.push(...[...document.querySelectorAll('.btn-accent')].map(e => e.dataset.action));
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      const tagColors = [...document.querySelectorAll('.tag')].map(t => getComputedStyle(t).color);
      return { pairs, accentEls: [...new Set(accentEls)], accent, accentInTags: tagColors.includes(toRgb(accent)) };
    });
    const low = Object.entries(info.pairs).filter(([, v]) => v < 4.5);
    check(`${scheme === 'light' ? '밝은' : '어두운'} 모드: 글자/배경 대비 WCAG AA(4.5:1) 이상`, low.length === 0 && Object.keys(info.pairs).length >= 8, info.pairs);
    check(`${scheme === 'light' ? '밝은' : '어두운'} 모드: 앰버는 만들기/추가 버튼에만`, info.accentEls.every(a => ['group-new', 'cl-new-list', 'trip-new', 'gear-new', 'camp-new'].includes(a)) && info.accentEls.length >= 4 && !info.accentInTags, info);
  }

  const errs = pages.flatMap(p => p.__errors);
  check('페이지 오류·네이티브 대화상자 없음', errs.length === 0, errs);
  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
  await browser.close(); srv.kill();
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
