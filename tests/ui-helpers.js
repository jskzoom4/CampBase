// 테스트 공통 도우미: ⋯ 메뉴 안으로 옮긴 버튼(삭제·이름 변경 등) 누르기.
// 메뉴가 닫혀 있으면 그 줄의 ⋯ 버튼을 실제로 눌러 연 다음 항목을 누른다(사람이 쓰는 순서 그대로).
async function menuClick(page, target) {
  const loc = (typeof target === 'string' ? page.locator(target) : target).first();
  await loc.waitFor({ state: 'attached', timeout: 5000 });
  if (!(await loc.isVisible())) {
    const btn = loc.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " more ")][1]/button[contains(concat(" ", normalize-space(@class), " "), " more-btn ")]');
    await btn.click();
  }
  await loc.click();
}
// Gear 선택 모드(3-3): "선택" → 장비 줄 고르기 → 아래 액션 바의 버튼 누르기. ids를 안 주면 첫 장비를 고른다.
async function gearAction(page, action, ids) {
  if (!(await page.locator('.select-bar').count())) await page.click('[data-action="gear-select"]');
  if (ids && ids.length) { for (const id of ids) await page.click(`.gear-row[data-action="gear-pick"][data-id="${id}"]`); }
  else await page.locator('.gear-row[data-action="gear-pick"]').first().click();
  await page.click(`.select-bar [data-action="${action}"]`);
}
module.exports = { menuClick, gearAction };
