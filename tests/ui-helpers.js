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
module.exports = { menuClick };
