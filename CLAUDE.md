# 캠프베이스 (CampBase) — 작업 안내

구글 계정으로 로그인해서 쓰는 캠핑 앱. 사람마다 개인 공간에 저장되고, 같은 계정으로 로그인한 기기끼리는 바로 동기화된다.
**그룹**을 만들면 멤버끼리 Checklist·Gear를 함께 보고 고치고, Camping 탭에서는 멤버가 공유한 후기를 보고 **함께 고친다**(초대 코드로 참여).
원칙: **그룹은 Checklist·Gear(함께 편집) + Camping 공유 후기(멤버 누구나 수정).** 후기의 원본은 항상 작성자의 개인 기록이고, 삭제는 내 기록에서만(그룹장은 "내리기").
사용자는 비개발자에 가깝다. **한국어로, 쉬운 말로** 설명하고, 바뀐 점과 설치 방법을 짧게 알려줄 것.

## 앱의 목적 (새 기능은 이 세 가지에 도움이 되는지로 판단)
1. 캠핑 갈 때 준비할 것 챙기기 — Checklist 탭
2. 내가 가진 캠핑 장비 조회 — Gear 탭
3. 다녀온 캠핑장 후기 남기기(사이트 크기, 화장실·매점 상태, 체크인/아웃 시간 등) — Camping 탭
   (+ 캠핑 식단 짜기·장보기 — Cooking 탭, 1번 "챙기기"의 일부)

## 구조
- `docs/index.html` — 앱 전체(HTML+CSS+JS 한 파일, 바닐라 JS, 빌드 도구 없음). 로그인 화면(`#login-screen`) + 탭: Home / Camping / Gear / Checklist / Cooking / Settings.
- `docs/firebase-config.js` — Firebase 프로젝트 `campbase-f5df5` 연결값(비밀 아님).
- `docs/sw.js`, `docs/manifest.webmanifest`, `docs/icons/` — 웹(홈 화면 설치)용.
- `firestore.rules.final` — 전환 기간 2단계용 초안(`firestore.rules`에서 전환 기간 블록만 뺀 것). **`firestore.rules`를 바꾸면 이 파일도 같이 바꿔야 한다**(규칙 테스트가 둘이 어긋나면 실패).
- `firestore.rules` — Firestore 보안 규칙. `users/{uid}/**`는 본인만, `groups/**`·`groupInvites`는 그룹 규칙(아래), 최상위 legacy 경로는 "전환 기간" 블록(현재 1단계: 로그인한 사람만 읽기 전용), 나머지는 거부.
- `firebase.json` — 에뮬레이터(규칙 테스트)용 설정. 실제 배포에는 쓰지 않음.
- `capacitor.config.json`, `package.json`, `assets/`, `keystore/` — 안드로이드 APK 빌드용(Capacitor 6 + `@capacitor-firebase/authentication` 6.x, `skipNativeAuth: true`).
- `android-config/google-services.json` — APK 구글 로그인용. 워크플로가 `android/app/`로 복사한다.
- `.github/workflows/build-apk.yml` — 모든 브랜치/PR에서 APK 빌드 → Actions Artifacts. **main일 때만** Releases(태그 `build-<run_number>`)에 올림.
  빌드 때 `docs/vendor/build-info.js`(`window.CAMPBASE_BUILD = { number: run_number, sha }`, 커밋 안 함)를 만든다.
- `tests/` — 가짜 Firestore/Auth로 돌리는 자동 테스트 + 에뮬레이터 테스트.

## 로그인과 저장 구조
- 로그인 상태는 **웹 SDK(firebase-auth.js)의 `onAuthStateChanged` 하나만** 본다.
  - 웹: `getAuth` + `GoogleAuthProvider` + `signInWithPopup`(팝업이 막히면 redirect).
  - APK(`window.Capacitor` 있음): `Capacitor.Plugins.FirebaseAuthentication.signInWithGoogle()`(네이티브) → `credential.idToken` →
    웹 SDK `signInWithCredential(GoogleAuthProvider.credential(idToken))`. auth는 `initializeAuth`(IndexedDB 유지, 팝업 도우미 없음).
  - 로그아웃: APK면 네이티브 `signOut()`도 호출 후 웹 SDK `signOut`.
- 저장 경로(로그인한 사람의 개인 공간):
  - `users/{uid}` — `{ name, email, photoURL, updatedAt }` (로그인할 때마다 갱신)
  - `users/{uid}/campingLogs|gear|checklists|cookingChecks/{id}` — 캠핑 기록 상태 필드: `toiletCondition`, `showerCondition`(샤워장, `SHOWER_LEVELS`, 선택), `storeCondition`
  - `users/{uid}/trips/{id}`, `users/{uid}/checklistTemplates/{id}` — 캠핑 일정·체크리스트 템플릿(아래 "캠핑 일정")
  - `users/{uid}/settings/app` — `{ gearCategories, gearCategoryMeta?, weatherLocation, homeWidgets }` (Home 위젯도 계정 기준. `weatherLocation`은 지금 화면에서 안 씀 — 날씨 기능용으로 남겨 둠)
- 최상위 `campingLogs/gear/checklists/cookingChecks`, `app/settings`는 **예전 공유 저장소(legacy)**. 새 앱은
  Settings → "기존 공유 데이터 가져오기"에서 **읽기만** 한다(내 공간으로 복사, 같은 id는 건너뜀, 원본 유지).
  로그인 직후 `checkLegacyAvailable()`이 legacy 데이터가 남아 있는지 `limit(1)`로 확인해서, 없거나 읽을 수 없으면(규칙 삭제 후) 버튼을 숨긴다(`state.legacyAvailable`).
- 설정값이 비어 있으면 미리보기 모드(로그인 없음, 예시 데이터, 저장 안 함).

## 삭제 되돌리기 · 백업 · 앱 버전
- 체크리스트 항목·리스트·장비·캠핑 기록 삭제는 `deleteDocWithUndo(kind, id, msg)` / `deleteChecklistItemWithUndo(listId, itemId)`를 쓴다.
  지우기 직전 문서를 기억해 두고 5초(`UNDO_MS`) 동안 토스트에 "되돌리기"(`data-action="undo-delete"`)를 보여준다. 마지막 삭제 하나만 기억(`_undo`), 일반 `toast()`가 뜨면 사라짐.
  되돌리면 **삭제한 그 공간**(그 사이 공간을 바꿔도)에 같은 id·같은 내용 그대로(`addedBy`, `updatedBy`, `assigneeUid`, `ownerUid` 등) `restoreDocRemote()`로 다시 저장. 항목은 리스트의 원래 위치로.
  확인 모달(리스트·장비·캠핑 기록)은 그대로 두고 확인 뒤 삭제에 되돌리기가 붙는다. 그룹 삭제·나가기·내보내기는 되돌리기 없음.
- 새로 "지우기" 기능을 만들면 되돌리기도 붙일 것.
- 그룹 백업(그룹장만, Settings → 내 그룹): `{ app:'campbase-group', version:1, exportedAt, groupName, gearCategories, checklists, gear }`.
  가져오기는 그 그룹의 체크리스트·장비·카테고리를 교체(멤버·이름 유지). 개인 백업(`app:'campbase'`)과 서로 섞이면 거부.
- 앱 버전: APK면 `vendor/build-info.js`를 읽어 Settings 맨 아래 "앱 버전: 빌드 N"(웹은 "웹 버전", 웹은 이 파일을 요청하지 않음).
  APK는 열 때 `checkForUpdate()`가 하루 한 번(`campbase.updateCheck`) GitHub 공개 API `releases/latest`의 `build-N`을 보고, 내 빌드보다 크면 `#update-banner`.
  받기 = `openExternal(LATEST_APK_URL)`(Capacitor가 앱 밖 주소를 기본 브라우저로 엶), 닫은 번호는 `campbase.updateDismissed`. 실패는 조용히.

## 캠핑 일정 (새 탭 없음: Checklist 탭 위쪽 + Home 카드)
- 일정: 개인 `users/{uid}/trips/{id}`, 그룹 `groups/{gid}/trips/{id}` =
  `{ title, startDate, endDate (YYYY-MM-DD), campsiteName, region, description?(메모, 비우면 필드 삭제), memberUids(그룹만, 참가 멤버), createdBy, createdAt, updatedBy }`. 저장은 `persistTrip()`.
  메모는 일정 만들기·수정 창의 `#tf-desc`, 일정 패널의 `.tp-desc`(3줄까지).
- 체크리스트의 선택 필드 `tripId` = 연결된 일정. 없는 리스트도 그대로 보인다. 일정을 보는 중에 만든 새 리스트는 그 일정에 연결.
- 템플릿: `users/{uid}/checklistTemplates/{id}`, `groups/{gid}/checklistTemplates/{id}` = `{ title, items:[{ label, group }], createdBy? }`(체크 상태·담당자 없음).
  **Checklist 하위 화면**: 지난 일정(`pastTrips`)·템플릿(`templates`). 데스크톱은 왼쪽 메뉴 Checklist 아래 하위 메뉴(`SUB_NAV`, `.nav-sub`) —
  Checklist 옆 화살표(`nav-sub-toggle`, 40×40)로 펼치기/접기(기기별 `localStorage` `campbase.navSubOpen`, 처음엔 펼침, 접힌 채 하위 화면이면 Checklist가 켜짐),
  휴대폰은 탭바 6개 그대로(하위 화면에서도 Checklist 탭이 켜짐, `NAV_PARENT`) + 세 화면 맨 위의 하위 탭 `subTabsHtml()`(체크리스트 | 지난 일정 n | 템플릿 n, `sub-nav`, 휴대폰에서만 보임).
  화면 이동은 `goView()` 하나로(지난 일정은 목록부터, Checklist로 오면 지난 일정 선택은 풂). Checklist 일정 줄에는 템플릿 버튼이 없다(사용자 요청: 템플릿 메뉴에서만).
  **템플릿 화면**(`renderTemplatesPage()`, 지금 공간 기준·공간 칩 있음).
  **지난 일정 화면**(`renderPastTripsPage()`, 지금 공간 기준): 끝난 일정을 최근 순·연도별 카드(`.past-trip-card`: 날짜·캠핑장, 리스트 수, 준비 n/m, 후기 남기기/내 후기 작성함).
  카드(`past-trip-open`) → 같은 화면에서 `tripPanelHtml()` + "지난 일정 목록"(`past-trip-back`). 선택은 `state.tripFilter`를 같이 쓴다.
  새 템플릿(`tpl-new`) = **장비에서 고르기**(장비가 있으면 기본: 만들고 바로 `gearPickModal(tplId, 'space', 'tpl')`) / 직접 입력("소분류: 항목" 줄 입력).
  템플릿 ⋯ "장비에서 불러오기"(`tpl-gear-import`, 만든 사람만). 템플릿 항목은 `{label, group}`만(체크 상태·담당자 없음).
  항목 추가(`tpl-add-item`)·빼기(`tpl-item-del`, 되돌리기)·이름 변경(`tpl-rename`)·삭제(`tpl-del`, 되돌리기)·"이 템플릿으로 새 리스트"(`tpl-make-list`). 리스트 ⋯의 `cl-save-template`도 그대로.
  **그룹 템플릿은 만든 사람(`createdBy`)만 고치기·삭제**(`tplCanEdit()`, 규칙도 같음: 만들기 createdBy==나, 수정은 만든 사람만, 삭제는 만든 사람·그룹장). 다른 멤버는 "보기 전용" + 새 리스트만.
  `createdBy`가 없는 예전 템플릿은 멤버 누구나 고칠 수 있음. 템플릿 저장은 `tplStamp()`로 createdBy를 넣는다. 일정 만들기 창에는 관리 대신 안내만(`refreshTripModalTemplates()`).
- 새 리스트(`newChecklistModal`)에서 템플릿 불러오기(`#ncl-tpl`, 고르면 빈 이름 칸에 템플릿 이름) → 항목 모두 미정으로 복사. 일정을 보는 중이면 그 일정에 연결.
- Checklist 탭: `subTabsHtml()`·`spaceChipsHtml()` 아래 `tripBarHtml()`(전체 n | 다가오는·진행 중 일정… | + 일정 만들기 — 지난 일정은 하위 메뉴로, 휴대폰은 한 줄 가로 스크롤). `state.tripFilter`('all' 또는 일정 id). 공간을 바꾸면 초기화.
  일정을 고르면 **일정 패널** `tripPanelHtml()` 하나(아래 "화면 규칙"): 날짜·D-n/진행 중/끝남, 캠핑장·지역, 참가 멤버, 진행률 `tripProgress()`(연결된 리스트 항목 중 결정된 것/전체, 그룹이면 내 담당 남은 개수), 필터, 연결된 리스트(`checklistListHtml(cl, ctx, true)`).
  "전체"를 고르면 예전 구조(리스트 카드들) + 한 줄 설명.
- **항목 추가**(`addChecklistItemModal`): 이름 + 개수(`#cli-qty`, 선택, −/+ `cli-qty-step`)만 — 소분류 칸은 없앰(사용자 요청). 소분류 제목의 +로 열면 그 소분류(숨은 `#cli-group`), 아니면 '기타'.
  항목의 선택 필드 `qty`(1~999 정수, 이름 옆 `×n` `.cl-qty`). 항목 ⋯ "이름·개수 고치기"(`cl-item-edit` → `saveChecklistItemEdit`, 비우면 qty 삭제).
- **리스트 접기**(준비물·장보기 모두): 리스트 머리 왼쪽 화살표 `button.cl-fold`(40×40) 또는 이름(`.cl-title`)을 누르면 `data-action="cl-fold"` → 머리만 보임(`.cl-closed`, 본문 `.cl-body[hidden]`).
  기기별 `localStorage` `campbase.clClosed`(리스트 id 목록). 식단표의 "장보기 열기"(`openShoppingList`)는 접힌 장보기를 펼친다.
- 일정 만들기 `tripFormModal()` → `saveTripForm()`: 체크리스트 시작 방법 = **장비에서 고르기**(빈 리스트 "이름 준비물"을 만들고 바로 `gearPickModal`) / 템플릿 복사(새 리스트, 항목 모두 미정) / 기존 리스트 연결 / 빈 리스트.
  기본값: 템플릿이 있으면 템플릿, 없고 장비가 있으면 장비에서 고르기.
- **장비에서 불러오기**(기본 흐름: 일정 만들기 → 리스트에서 Gear 장비를 골라 불러와 체크): `gearPickModal(listId, src, kind)` → `gearPickGo()`(kind `'tpl'`이면 템플릿에 넣음).
  입구 = 리스트 ⋯ 메뉴 맨 위(`cl-gear-import`), 빈 리스트의 버튼, 리스트 없는 일정 패널의 `trip-gear-import`(리스트를 만들고 엶).
  장비는 카테고리 묶음별(`gearCatTree`), 전체 선택(`#gpk-all`)·묶음 선택(`.gpk-sec-box`)·개별(`.gpk-item`) — 체크 상태는 `gpkSync()`(change 이벤트 `data-action="gpk-toggle"`), 일부만이면 indeterminate.
  리스트에 이미 있는 이름(`normName`)은 "이미 있음"으로 고를 수 없음. 그룹 공간에서는 [그룹 장비 | 내 장비](`gpk-src`) — 그룹 장비는 주인(지금 멤버)이, 내 장비는 내가 담당자.
  항목 넣기는 Gear 탭 "체크리스트에 추가"와 같은 `addGearItemsToList()`.
- 일정 삭제(`deleteTripConfirm`)는 연결된 리스트를 지우지 않고 `tripId`만 해제, 되돌리면 일정과 연결 모두 복구(`deleteDocWithUndo`의 `after`).
- 그룹 일정은 Home 카드 때문에 **내 모든 그룹**의 trips·checklists를 늘 구독한다(`syncGroupBackground()` → `state.groupTrips[gid]`, `state.groupTripLists[gid]`). 그룹 공간의 `SP.trips`도 여기서 읽는다.
  선택한 그룹의 템플릿은 `startSpaceData()`에서 `state.groupTemplates`로.
- Home "다음 캠핑" 카드(`nextTripHtml()`, 위젯 키 `nextTrip` — 예전 `location` 값을 `normalizeHomeWidgets()`가 이어받음): 개인 일정 + 내가 참가하는 그룹 일정 중
  가장 가까운 다가오는/진행 중 일정 1개. 누르면 그 공간의 Checklist 탭에서 그 일정 선택(`openTripFromHome`). 없으면 "다음 캠핑 일정을 만들어보세요".
  끝난 지 7일 이내이고 내 후기가 없는 일정은 "'이름' 후기를 남겨보세요". Home의 다른 통계는 개인 데이터만.
- **Camping에서도 지난 일정으로 후기 쓰기**(같은 캠핑장이 이름이 달라 다른 캠핑장 후기로 갈라지지 않게): `reviewDueTrips(maxAgo?, space?)` = 후기 없는 끝난 일정(개인 + 참가 그룹, 최근 순, Home은 7일 이내).
  내 기록 보기 위쪽 `campReviewDueHtml()` 카드(`.camp-due`, 3개까지 + `camp-due-more`, 줄은 `trip-review`), 그룹 후기 보기에는 그 그룹 일정만.
  새 기록 폼(일정에서 온 게 아닐 때)의 `#cf-trip` "지난 일정에서 불러오기" → `campFormPickTrip()`: 이름·지역·날짜 채움 + tripRef 연결 + 그룹 일정이면 그 그룹 공유 켬("직접 입력"으로 돌리면 해제).
  캠핑장 이름 칸은 `datalist#cf-name-list`(`knownCampNames()`: 내 기록·일정·보고 있는 그룹 후기 이름).
- 후기 남기기: 끝난 일정 카드의 `trip-review` → **내 개인** 캠핑 기록 폼을 캠핑장 이름·지역·시작일로 미리 채움(`campFormModal(null, prefill)`),
  저장하면 캠핑 기록에 선택 필드 `tripRef: { space: 'me'|gid, tripId }`. `hasMyReview()`로 "내 후기 작성함" 표시. 기록 수정(`saveCampForm`)은 기존 필드(tripRef 등)를 유지.
- 개인 백업에 `trips`, `checklistTemplates` 포함(필드가 없는 예전 백업을 가져오면 지금 일정·템플릿은 그대로 둔다).

## 캠핑 식단·장보기 (Cooking 탭, 새 탭·새 컬렉션 없음, 규칙 그대로)
- 흐름: 일정 고르기 → 끼니마다 메뉴 → 장보기 목록 자동 생성(일정의 체크리스트) → 마트에서 체크 → 캠핑장에서 식단표로 메뉴·재료 보기.
- 레시피 `COOKING_RECIPES`: `serves`(기준 인원 2) + 재료 `{ name, qty?, unit?, cat, home? }`(`ingr()`로 정의). qty·unit은 serves 기준, qty 없으면 "적당량".
  cat = `SHOP_CATS`('고기·해산물'|'채소·과일'|'가공·면·유제품'|'양념·소스'|'음료·기타'), home = 보통 집에 있는 것(→ "집에서 챙길 것"). 재료 이름 배열이 필요하면 `ingNames(r)`.
- 식단 = **일정 문서의 선택 필드**(개인 `users/{uid}/trips`, 그룹 `groups/{gid}/trips`): `mealServings?`(기본 인원, 없으면 그룹 = 참가 멤버 수, 개인 = 2),
  `meals?: [{ id, day(1~), slot('breakfast'|'lunch'|'dinner'|'extra'), label?(extra 이름), servings?, done?, dishes:[{ id, recipeId?, name, assigneeUid?(그룹) }] }]`.
  - 기본 끼니 칸(`defaultSlots`: 첫날 점심·저녁, 중간 아침·점심·저녁, 마지막 아침·점심, 당일치기 점심·저녁)은 저장 전엔 빈 칸(id `m{day}_{slot}`, 같은 칸은 늘 같은 id).
    비어 있고 따로 정한 게 없는 기본 칸은 저장하지 않는다(`pruneMeals`). 화면 배치는 `mealLayout(t)`(날짜별 + 날짜 밖), 요약은 `mealStats(t)`(planned/total/dishes).
  - 범위를 벗어난 끼니(일정 날짜를 줄임)는 지우지 않고 "날짜 밖" 묶음 → 옮기기(`meal-move`, 같은 칸이면 합침)·지우기.
  - 저장은 **`mutateMeals(space, tripId, op, extra?)` 하나로**: op(meals 배열을 고치는 함수, 여러 번 적용해도 같은 결과 — `mealOps.*`)를 내 화면에 먼저,
    그다음 저장소의 최신 일정에 다시 적용해 `update({ meals, updatedBy, ...extra })`(다른 필드는 그대로). 최근 8초 op는 `replayMealOps()`가 일정 스냅샷마다
    다시 적용해 빠졌으면 다시 저장(거의 동시에 다른 기기가 예전 식단으로 덮어쓴 경우). **Cooking은 공간을 바꾸지 않고** 일정이 속한 공간(`spaceDbOf(space)`)에 바로 저장.
- 장보기 = 같은 공간의 체크리스트 `{ title:'장보기', kind:'shopping', tripId }`(일정 하나에 1개, 진행률에 포함). 자동 항목은 기존 항목 구조 + `src:'meal'`, `key`(normName),
  `qtyText`, `qtyEdited?`, `uses:[메뉴]`, `home?`, `homeFrom?`(집에 있어요 전 소분류), `gone?`(식단에서 빠짐). 직접 추가한 항목엔 src 없음.
  - **자동 맞춤 `syncShoppingList(space, tripId)`**(식단이 바뀔 때마다, 목록이 있을 때만): done 아닌 끼니의 레시피 재료를 이름별로 합침(`shoppingNeeds`),
    양 = 기준 양 × 끼니 인원 ÷ serves를 단위별 합산 후 올림(`roundQty`: g·ml 50 단위, 그 밖 0.5 단위), 단위가 다르면 "400g + 4개".
    `mergeShopping`: 기존 자동 항목은 체크·담당자·home·qtyEdited 양·소분류 유지, qtyText(안 고쳤을 때)·uses만 갱신. 빠진 재료는 pending이면 삭제, 체크했으면 `gone`.
    직접 추가 항목은 안 건드림. key 중복(동시 생성)은 하나로. 새 항목 담당자 = 그 재료를 쓰는 메뉴 담당자가 한 사람으로 같을 때만. 저장소 최신 목록을 받아 맞춘 뒤 저장.
  - 목록을 지우면 다시 만들지 않는다("장보기 목록 만들기"가 다시 보임). 일정을 지우면 다른 리스트처럼 tripId만 풀리고 kind는 그대로(자동 맞춤 멈춤, 안내 문구).
  - Checklist 화면은 `checklistListHtml` 그대로 + kind shopping일 때만: 장바구니 아이콘·"식단에서 자동으로 만든 목록이에요 · 식단표 보기", 이름 옆 양·아래 쓰이는 메뉴,
    체크 버튼 이름만 "샀어요/챙겼어요"·"안 사요"(상태 값은 packed/skip 그대로), 항목 ⋯ "집에 있어요/사야 해요"(`shop-home`),
    **양(개수·중량)은 화면에 안 보임**(사용자 요청: 양은 이름에 적음. "양 고치기" 없앰. 레시피 항목의 `qtyText`는 계산해서 저장만),
    **소분류로 나누지 않고 한 목록**(사용자 요청: 제목·소분류 + 버튼 없음, 살 것 먼저·집에서 챙길 것은 맨 아래 + "집에 있음" 태그, 항목 추가 창에 소분류 칸 없음 —
    항목의 `group` 값은 예전처럼 저장만 함), "템플릿으로 저장"·"장비에서 불러오기" 숨김.
- Cooking 탭: **식단표 하나**(레시피 탭은 사용자 요청으로 없앰. `COOKING_RECIPES`는 메뉴 넣기 창의 "레시피에서 고르기"·기존 레시피 메뉴의 재료 계산용으로 남김).
  - 식단표: 일정 칩 = `allMyTrips()`의 다가오는·진행 중 일정(그룹 이름 작게) + "지난 일정" 접기(`cook-past-toggle`). 고른 일정 `state.cookSel`({space, tripId}), 없으면 가장 가까운 것.
    요약 카드(식단 n/m끼 정함 · 기본 n명(`meal-servings`) · 장보기 만들기(`shop-create`, 레시피 메뉴가 있을 때만)/열기(`shop-open` → `openShoppingList`)),
    날짜 카드(`.meal-day`) 안 끼니 줄(`.meal-row[data-meal-row]`: 이름 · 인원 칩(다르면 `.diff`) · 메뉴 칩(누르면 그 끼니 인원 기준 레시피 펼침, ⋯ 담당자(그룹)·옮기기·빼기(되돌리기)) · "+ 메뉴"),
    끼니 ⋯ 다 먹었어요(done)·옮기기·비우기(되돌리기)·지우기(추가 끼니·날짜 밖), 날짜마다 "+ 끼니 추가"(간식·야식·술안주·직접).
    메뉴 넣기 창 `mealPickerModal`: **음식 이름(`#mp-custom`) + 재료(`#mp-ings`, 선택)** 직접 입력이 기본. 재료를 적으면 메뉴 하나, 이름만이면 쉼표로 여러 개.
    아래 `<details class="mp-recipes">` "레시피에서 고르기"(검색 `#mp-search`·종류 칩·여러 개 선택).
  - 직접 입력 메뉴의 선택 필드 `ingredients: [{ name }]` — **양은 따로 나누지 않고 이름에 같이**(`parseIngredients("삼겹살 600g, 쌈장")` → `[{name:'삼겹살 600g'},{name:'쌈장'}]`,
    같은 이름은 하나, 40개까지). 예전에 `qty`·`unit`을 따로 저장한 재료는 `dishIngs()`가 이름에 붙여 보여 준다. 장보기 항목 이름 = 재료 이름 그대로.
    펼치면 재료 목록, 메뉴 ⋯ "이름·재료 고치기"(`dish-edit` → `dishEditSave`, 레시피 메뉴는 없음). 장보기 만들기는 재료 있는 메뉴(`dishHasIngs`)가 있을 때.
  - 연결: 일정 패널 진행 줄 옆 `mealLinkHtml()`("식단 n/m"·"식단 짜기" → `openTripMeals`), Home 다음 캠핑 카드 " · 식단 n/m끼"(메뉴가 있을 때만),
    지난 일정 카드 "해먹은 메뉴 n개". 식단 없는 일정은 예전과 똑같이 보인다.
- 예전 레시피별 재료 체크 `cookingChecks`는 **화면에서만 뺐다**. 구독·legacy 가져오기·개인 백업 내보내기/가져오기 형식은 그대로(되돌려도 데이터 그대로).

## 그룹 후기 공유 (Camping 탭, 멤버 누구나 수정)
- 개인 캠핑 기록의 선택 필드 `sharedGroupIds: [gid, ...]`(없으면 공유 안 함). 공유한 그룹마다 사본
  `groups/{gid}/sharedReviews/{내uid}_{기록id}` = 후기 필드(`REVIEW_FIELDS`: name, date, region, siteType, siteSize, rating, checkinTime, checkoutTime, toiletCondition, showerCondition, storeCondition, notes, tripRef) + `{ authorUid, sourceLogId, updatedBy, updatedAt }`.
- 동기화는 **`syncReviewCopies(prev, next)`** 하나로(켠 그룹 저장·갱신, 끈 그룹 삭제, next=null이면 모두 삭제): 기록 저장(`saveCampForm`), 삭제(+되돌리기 때 다시 만들기), 개인 백업 가져오기 후.
  개인 기록을 바꾸는 새 코드를 만들면 이 함수도 불러야 한다.
- **함께 고치기**: 그룹 후기 창의 "수정"(`review-edit` → `editGroupReview()`). 내 후기면 내 기록 폼(`campFormModal(logId)`, 그룹 보기 그대로),
  남의 후기면 `campFormModal(null, null, {gid, rid})` → `saveGroupReviewEdit()`가 **그룹 사본만** 고친다(`updatedBy` = 나, authorUid·sourceLogId 그대로, 공유 칩 없음).
  작성자 앱은 `syncGroupBackground()`에서 내 모든 그룹의 `sharedReviews where authorUid==나`를 구독(`state.myReviewCopies`)하고, `updatedBy`가 남인 사본을
  `applyReviewEdits()`로 내 기록에 반영(`editedBy: {uid, gid, at}` → 목록에 "○○ 님이 고침") + `syncReviewCopies`로 다른 그룹 사본도 맞춤(updatedBy가 다시 나 → 반복 없음).
  작성자가 내 기록을 저장하면 `editedBy`는 지운다. 반영은 작성자가 앱을 열었을 때 일어난다(그 전에는 그룹 사본만 바뀐 상태).
- **그룹 화면에서 기록 추가**: 그룹 후기 보기의 "기록 추가"(`camp-new-group` → `campFormModal(null, { shareGid })`) = 내 개인 기록에 저장 + 그 그룹 공유 칩이 켜진 채.
- 없어진 그룹(삭제·나감)의 gid는 `cleanupSharedGroupIds()`가 내 기록에서 조용히 지운다 — 그룹 목록을 **서버에서** 받은 뒤에만(`state.groupsServerLoaded`, 어댑터 `wrapQuery`의 `fromCache`).
  그룹을 나가도 내가 올린 사본은 그룹에 남는다(작성자는 나간 뒤에도 규칙상 자기 사본 삭제 가능). 그룹 삭제 시 `sharedReviews`도 함께 삭제. 그룹 백업에는 넣지 않음.
- 규칙(`firestore.rules`의 `sharedReviews` 블록): 읽기 = 멤버, 만들기 = 멤버 + `authorUid == 나` + 문서 id `== 나_sourceLogId`,
  수정 = 멤버 + authorUid·sourceLogId 변경 불가 + (작성자면 위 조건, 다른 멤버면 `updatedBy == 나`), 삭제 = 작성자 본인 또는 그룹장.
  `sharedReviews`는 일반 하위 컬렉션 허용 목록(`GROUP_SUBCOLLECTIONS`)에 **넣지 않는다**(넣으면 아무 멤버나 쓸 수 있게 됨).
- 기록 폼의 "그룹에 공유" 칩(`_campShare`, `cf-share-toggle`): 기본 꺼짐, 그룹 일정에서 "후기 남기기"로 온 새 기록·그룹 화면 "기록 추가"는 그 그룹이 켜짐. 목록에 "○○ 공유" 태그.
- 내 기록 목록의 후기 줄(`.camp-line3`)은 2줄 말줄임. 줄이나 "더보기"(`.camp-more`)를 누르면 펼침/접힘(`camp-expand`, `state.campExpanded`, 화면 상태만).
  실제로 넘칠 때만 `markCampClamps()`가 `.can-expand`와 "더보기"를 켠다(renderView 뒤·창 크기 변경 때).
- "전체" 칩에는 전체 개수(내 기록 수, 그룹 후기 캠핑장 수, Gear 장비 수, Checklist 일정 줄의 "전체" = 지금 공간의 리스트 수).
- Camping 탭 위쪽 보기 전환 `[내 기록 | 그룹A 후기 | …]`: `state.campView`('me' 또는 gid, 기기별 `localStorage` `campbase.campView.<uid>`, Checklist·Gear 공간과 따로).
  그룹 보기는 `startReviewData()`로 그 그룹의 `sharedReviews`만 구독 → `renderGroupReviews()`: 캠핑장별 카드(`groupReviewCards`, `normName`으로 묶음 — 후기 수, 평균 평점, 최근 방문일, 작성자 사진, 화장실·매점 최빈값),
  지역 필터·정렬(최신순·평점순). 카드 → `reviewDetailModal()`(멤버별 후기, 모두에게 "수정", 남이 고쳤으면 "○○ 님이 고침", 그룹장에겐 남의 후기 "그룹에서 내리기"(confirmModal, 되돌리기 없음 — 그룹장은 남의 사본을 다시 만들 수 없음)). 나간 멤버는 "나간 멤버".
- Home 통계는 개인 기록만.

## 그룹
- `groups/{gid}` = `{ name, ownerUid, memberUids: [...], members: { uid: { name, photoURL, role: 'owner'|'member' } }, createdAt, gearCategories, gearCategoryMeta?, joinCode? }`
  - `groups/{gid}/checklists|gear|trips/{id}` — 멤버 모두 읽기·쓰기, `checklistTemplates`는 위 "템플릿" 규칙(앱의 `GROUP_SUBCOLLECTIONS` = 이 넷. 새 하위 컬렉션을 쓰려면 규칙·`.final`·가짜 SDK의 `GROUP_SUBS`에 추가). 그룹 공간에서 저장하면 `addedBy`(처음 만든 사람)·`updatedBy`(마지막 수정) uid를 남긴다.
  - 그룹 장비 카테고리는 `groups/{gid}.gearCategories` + `gearCategoryMeta`(아래 "장비 카테고리"). 멤버는 이 두 필드만 바꿀 수 있다(규칙).
  - 내 그룹 목록: `state.rootDb.collection('groups').where('memberUids','array-contains', uid)` 실시간 구독 → `state.groups`.
- `groupInvites/{code}` = `{ gid, groupName, createdBy, expiresAt(밀리초 숫자), createdAt }`. 코드는 6자리, 문자 `INVITE_CHARS`(0/O/1/I 제외), 7일 만료.
- 참여: `groups/{gid}`에 `update({ memberUids: arrayUnion(나), 'members.나': {...role:'member'}, joinCode: 코드 })` — 규칙이 `joinCode`로 초대 코드(같은 gid, 만료 전)를 `get()`해서 확인한다.
  나가기/내보내기는 `arrayRemove` + `deleteField()`. 그룹장은 나갈 수 없고 삭제만(하위 데이터(`GROUP_SUBCOLLECTIONS` 전부) → 초대 코드 → 그룹 문서 순서로 삭제).
- **공간 전환은 Checklist·Gear 탭에만**(일정·템플릿도 Checklist 탭의 지금 공간 기준) (`spaceChipsHtml()`, `state.space` = `'me'` 또는 gid, 기기별 `localStorage` `campbase.space.<uid>`).
  Home·Camping(내 기록)·Settings·백업·legacy 가져오기는 항상 개인 공간(`state.db`, `state.checklists`, `state.gear`). Camping의 그룹 후기 보기는 위 "그룹 후기 공유"(따로 전환).
  Cooking 식단표는 공간 전환 없이 고른 일정의 공간에 바로 저장(위 "캠핑 식단·장보기").
- Checklist·Gear 코드는 `SP.checklists / SP.gear / SP.gearCategories`(지금 공간)와 `spaceDb()`로 읽고 쓴다. 이 두 탭에서 `state.checklists`/`state.gear`를 직접 쓰지 말 것.
  카테고리 저장은 `persistGearCategories()`(그룹이면 그룹 문서, 아니면 개인 설정).
- 그룹 데이터 구독은 `selectSpace()` → `startSpaceData()`/`stopSpaceData()`. 권한이 없어지면(내보내짐·삭제) 조용히 내 공간으로 돌아온다.
- "그룹으로 보내기": 개인 체크리스트(리스트 단위)·장비(여러 개)를 새 id로 그룹에 **복사**. 없는 장비 카테고리는 그룹에 추가.
- **담당자(그룹 체크리스트 항목)**: 항목의 `assigneeUid`(멤버 uid만 저장, 선택). 이름·사진은 그룹 `members`에서 찾아 표시(`memberName()`, `memberAvatarHtml()`),
  나간 멤버면 "나간 멤버". 항목 옆 `assignee-chip` → `assignModal()` → `setAssignee()`. 필터 `'mine'`("내 담당")은 그룹 공간에서만.
- **장비 주인(그룹 장비)**: 장비의 `ownerUid`(선택). 장비 폼의 `#gf-owner`(그룹 공간에서만), 목록의 `owner-tag`, 주인 필터 `state.gearOwnerFilter`(`'all'|'none'|uid`, 공간 바꾸면 초기화).
- **담당자 추천**: `assignModal()` 맨 위 `assignSuggestHtml()` — 항목 이름과 비슷한(`namesSimilar`: 공백·대소문자 무시, 한쪽이 다른 쪽을 포함) **그룹 장비**의 주인(지금 멤버만).
  다른 멤버의 개인 장비는 규칙상 못 보므로 대상 아님. 추천이 없으면 기존 목록만.
- **장비 → 체크리스트**(개인·그룹 모두): Gear 탭 "체크리스트에 추가"(`gearToChecklistModal` → `addGearToChecklist`). 같은 공간의 리스트를 일정별로 묶어 고르고(`checklistOptionsHtml`),
  장비 이름 = 항목, 카테고리 = 소분류. 같은 이름(`normName` 같음) 항목은 건너뛰고 "○개 추가, ○개는 이미 있음". 그룹이면 주인(지금 멤버)을 담당자로, `addedBy` 기록.
- 담당자·주인은 **개인 공간에서는 보이지 않는다.** 필드가 없는 기존 항목도 그대로 보인다.
- 장비 수정(`saveGearForm`)은 기존 필드(`addedBy`, `ownerUid` 등)를 유지하고 폼 값만 덮어쓴다.

## 장비(Gear)와 카테고리
- 장비 = `{ name, brand(직접 입력), category, comment?, ownerUid?(그룹), addedBy?, updatedBy? }`. 예전 장비의 `price/weight/date`는 지우지 않고 남겨 두지만 화면·폼에서는 안 씀.
- 카테고리는 **대분류/소분류**. `gearCategories` = 소분류 이름 순서(예전 앱도 읽는 목록), 선택 필드 `gearCategoryMeta = { majors:[{name, desc}], subs:[{name, major, desc}] }`
  (대분류 순서·설명, 소분류의 대분류·설명). 장비의 `category`는 소분류 이름 / 대분류 이름(소분류 없이 바로) / `''`(미분류). 대분류·소분류 이름은 서로 겹치지 않게, '미분류'는 이름으로 못 씀.
- **기본 카테고리·잠금 없음**: 새 사용자·새 그룹은 빈 목록. 저장한 적이 없으면(`null`) 장비에 쓰인 카테고리를 보여준다(`deriveGearCats`). 어떤 카테고리든 지울 수 있고, 장비는 지우지 않고 대분류(있으면) 또는 미분류로 옮긴다.
  `SP.gearCategories`는 null이면 계산값을 돌려주므로 **push 말고 새 배열을 대입**한다. 저장은 `persistGearCategories()`(두 필드 함께).
- 화면은 `gearCatTree(cats, meta, gear)` 하나로 그린다: [대분류(+소분류)… → 대분류 없는 소분류… → 목록에 없는 카테고리(장비에만 있음) → 미분류]. `gearTopKey`/`gearInCat`로 거른다.
  Gear 전체 보기 = 묶음 카드(`.gear-sec`, 머리 `gear-sec-toggle`로 접기, 기기별 `localStorage` `campbase.gearClosed`), 대분류 칩을 고르면 아래 줄에 소분류 칩. 고른 카테고리가 "장비 추가"의 기본값(`defaultGearCategory`).
  카테고리 묶음 머리·소분류 제목의 + 버튼(`gear-new` + `data-cat`)으로 그 카테고리에 바로 장비 추가(선택 모드에서는 숨김). Home에는 장비 통계가 없다(J-4).
- 카테고리 관리 창: 위/아래(`gear-cat-move`), 연필(`gear-cat-edit` → 이름·대분류·설명, 삭제 `gear-cat-del`), 추가(`#cat-new-name` + `#cat-new-parent`: 대분류 없음/대분류 안/대분류로 만들기). 목록만 바꿀 땐 `refreshCatManage()`.
- 개인·그룹 백업에 `gearCategoryMeta` 포함(없는 예전 백업도 그대로 가져옴).

## 배포 흐름
- 브랜치/PR에 push → GitHub Actions가 APK 빌드(5~10분) → 그 실행 화면 아래 **Artifacts**(`campbase-apk-번호`, zip)에서 받아 폰에서 테스트.
- main에 반영 → 같은 빌드 + Releases에 `campbase.apk` 게시.
- 친구 공유 링크(항상 최신, main 빌드만): `https://github.com/jskzoom4/CampBase/releases/latest/download/campbase.apk`
- 폰에서는 같은 링크로 받아 덮어 설치하면 됨(서명키 고정, 데이터는 Firebase에 있어 유지).
- GitHub Pages(main `/docs`)를 켜면 아이폰용 웹 주소 `https://jskzoom4.github.io/CampBase/`.
  웹 로그인이 되려면 Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 `jskzoom4.github.io`가 있어야 한다.
- 되돌리기: 문제가 된 변경을 revert하면 다시 빌드됨. 예전 APK도 Releases에 남아 있음.

## 화면 규칙 (새 화면·버튼을 만들 때 지킬 것)
- **하단 탭바(820px 이하)**: `#mobile-tabbar`(화면 아래 고정, 6개 탭 아이콘+짧은 이름, 지금 탭 `aria-current`). 안전 영역 `--safe-bottom`,
  탭바 높이 `--tabbar-h`만큼 `#main` 아래 여백. 입력칸에 초점이 가거나 화면이 줄면(키보드) `body.kbd-open`으로 탭바를 숨긴다.
  데스크톱은 왼쪽 사이드바(`#nav`) 그대로, 연결 상태 알약(`#db-status-top`)은 위쪽. 탭 버튼은 `data-nav`(테스트도 이걸로 찾음).
- **⋯ 메뉴(공통 컴포넌트)**: 한 줄·카드에 버튼이 여러 개면 가장 자주 쓰는 동작 1개만 보이게 두고 나머지는 `moreMenuHtml(key, items, label)`로.
  `items = [{ action, attrs:{'data-id':…}, icon, label, danger }]` — 항목도 **같은 data-action**으로 `wireGlobalActions()`에서 처리된다.
  위험한 항목(`danger:true`, 삭제·나가기)은 빨간색으로 맨 아래. 바깥 클릭·Esc로 닫힘, 화살표/Home/End/Tab/Enter 지원, 한 번에 하나만 열림(`closeAllMenus`).
  지금 메뉴에 있는 것: 리스트(장비에서 불러오기·이름 변경·초기화·템플릿으로 저장·그룹으로 보내기·삭제), 소분류(이름 변경), 항목(이름·개수 고치기·삭제, 장보기면 집에 있어요), 캠핑 기록(삭제), 일정 패널(수정·새 리스트·삭제), 그룹 행(멤버·이름 변경·백업·삭제/나가기),
  식단 끼니(다 먹었어요·옮기기·비우기·지우기), 식단 메뉴(담당자·옮기기·빼기).
  **Gear는 예외**: 장비 줄은 연필(수정) + X(삭제, `gear-del`, 확인 후 되돌리기) 버튼, 카테고리 관리는 "장비 추가" 옆에 바로 보이는 버튼(사용자 요청).
  메뉴 위치는 `placeMenu()`: 아래로 펼쳐서 하단 탭바(위쪽 끝)를 넘으면 위로, 위도 모자라면 화면 안에 `position:fixed`로(넘치면 메뉴 안 스크롤). #main을 스크롤하면 닫힌다.
  테스트에서 메뉴 안 버튼은 `tests/ui-helpers.js`의 `menuClick(page, selector)`로 누른다(메뉴를 열고 누름). Gear 선택 모드 동작은 `gearAction(page, action, ids)`(선택 모드로 고르고 액션 바 버튼을 누름).
- **모달**: `openModal()`이 오른쪽 위 닫기(X, `data-action="modal-close"`)를 자동으로 넣는다. Esc로 닫기, 나타남/사라짐 효과(fade+scale, `prefers-reduced-motion`이면 없음).
  열리면 첫 입력칸(없으면 첫 버튼)으로 초점, Tab은 모달 안에서만, 닫히면 연 버튼으로 초점 복귀(다시 그려졌으면 같은 data-action 버튼, 메뉴 항목이면 그 ⋯ 버튼).
  **입력칸(input·select·textarea)이 있는 모달은 배경을 눌러도 안 닫히고**, 확인만 하는 모달은 배경을 누르면 닫힌다. 사라지는 중인 모달은 `#modal-ghost`로 옮겨 버튼·id를 지운다.
  `openModal()`은 내용을 `.modal-body`(스크롤됨)로 감싸고, 맨 끝 `.modal-actions`(취소·저장)는 **아래 고정 버튼 바** `.modal-foot`으로 옮긴다 → 긴 폼도 저장 버튼이 항상 보임.
  아래쪽 "닫기" 버튼은 만들지 않는다(X로 충분). 버튼이 "닫기"뿐이면 `.modal-actions`를 넣지 말 것.
  **휴대폰(820px 이하)에서는 시트형**: 화면 아래에 붙고 폭 전체, 위쪽만 둥글게, 아래에서 올라오는 효과(`cb-sheet-in`). 높이는 보이는 화면(`--vvh`, visualViewport)의 90% 이하라
  키보드가 올라와도 버튼 바가 보이고, 초점이 간 입력칸은 `.modal-body` 안에서 보이게 스크롤된다.
- **Checklist 하위 탭**(휴대폰): 하위 탭 줄이 생긴 만큼 일정 칩은 한 줄 가로 스크롤(`.trip-chips` nowrap), 공간 칩 아래 여백 8px — "첫 준비물 위쪽 절반" 테스트 여유가 4px뿐이니 위쪽에 줄을 더하면 확인.
- **누르는 영역** 최소 40×40(`.icon-btn`), 아이콘만 있는 버튼에는 `aria-label` 필수(테스트가 검사).
- **초점 표시**: 키보드로 움직일 때만 `:focus-visible` 브랜드 초록 2px 테두리(+2px 간격). `outline:none`을 따로 쓰지 말 것.
- **색**: 앰버(`--accent`, 글자는 `--on-accent`)는 **만들기/추가 버튼에만**(`.btn-accent`: 기록 추가·장비 추가·새 리스트·그룹 만들기·일정 만들기 칩).
  진행률 숫자·태그·배지는 중립(`.tag` 회색), 완료는 초록(`.done-tag`, `--good-text`). 글자용 색은 `--brand-text`/`--good-text`/`--bad`, 칠하는 배경은 `--brand`/`--good`/`--bad-solid`.
  밝은·어두운 모드 모두 글자 대비 4.5:1 이상(테스트가 계산해서 확인). 새 색을 쓰면 두 모드 다 확인.
- **일정 패널**(Checklist, 일정 선택 시): `section.trip-panel` 하나에 머리(`.trip-panel-head`: 이름 + 상태 태그 또는 "후기 남기기" + ⋯), 장소·멤버, 진행률, 필터 + "새 리스트", 리스트.
  머리는 #main 안에서 `position:sticky`(`top: calc(-1 * var(--main-pt))`, 스크롤 컨테이너의 위 여백만큼 올려야 딱 붙음). 붙으면 `updateStickyHeads()`가 `.stuck`을 붙여
  한 줄 요약(`.tp-mini`: · D-n · 준비 n/m)을 보여준다. 연결된 리스트가 없으면 `.tp-empty`(새 리스트 / 템플릿에서 가져오기 `trip-tpl-import`).
  390px에서 일정을 고르면 첫 준비물 항목이 화면 위쪽 절반 안에 있어야 한다(테스트가 확인) — 패널 위쪽에 줄을 더하면 확인할 것.
- **선택 모드 + 아래 액션 바**(Gear): 여러 개를 골라 하는 동작은 버튼을 늘어놓지 말고 "선택" → 줄을 눌러 고르기(체크 표시, Enter/Space) → 화면 아래 `.select-bar`
  (n개 선택 · 동작 버튼 · 취소). 0개면 동작 버튼 비활성, 성공·공간 변경·탭 이동 때 선택 모드 끝. 고른 것은 열리는 창에 미리 체크된다.
  카테고리마다 전체 선택 상자(`gear-pick-many`, `role=checkbox`, `aria-checked` true/false/mixed): 묶음 머리, 소분류 제목, 칩으로 고른 목록 위 줄. 모두 골라져 있으면 누를 때 모두 해제.
- **별점 입력**: `starInputHtml(v)` — 숨은 `#cf-rating` + `role="radiogroup"` 안에 별 5개 버튼(`role="radio"`, `aria-checked`, `data-action="cf-star"`). 같은 별 다시 누르면 0,
  화살표/Home/End로 바꾼다. select로 되돌리지 말 것.
- **본문 최대 폭**: `renderView()`가 `<div class="view view-<탭>">`로 감싼다. Home을 뺀 탭은 `max-width:780px` 가운데 정렬. 새 탭도 이 안에 그린다.
- **체크 버튼**(가져감/안 가져감): 버튼 자체가 40×40(누르는 영역), 보이는 칸은 `::before` 32px. 보이는 크기를 줄이려고 버튼 크기를 줄이지 말 것.
- **Home 통계**: 캠핑 기록·준비물 체크 두 가지(보유 장비 통계는 없앰, 예전 `homeWidgets.gear` 값은 무시). 휴대폰은 가로 막대(`.stat-bars`), 데스크톱은 원형. 0개 항목은 범례·막대 모두 숨김.
- **보이는지 확인할 때 `offsetParent`를 쓰지 말 것**: `position:fixed` 요소(탭바·메뉴·액션 바)는 보여도 `offsetParent`가 `null`이다. 앱은 `isShown(el)`(계산된 display/visibility + 크기),
  테스트는 Playwright `isVisible()`이나 `elementFromPoint`(실제로 눌리는지)를 쓴다. 메뉴가 탭바에 가리는지는 메뉴 항목 가운데를 `elementFromPoint`로 확인.
- 화면을 바꾸면 `node tests/screenshots.js <폴더> [docs 폴더]`로 390px·1280px × 밝은/어두운 모드 스크린샷을 찍어 확인할 수 있다(자동 테스트 아님).

## 꼭 지킬 규칙
- **네이티브 `alert` / `confirm` / `prompt` 금지.** 확인이 필요하면 `confirmModal(message, label, onConfirm)`을 쓴다.
- 클릭/변경 이벤트는 `data-action` 속성 + `wireGlobalActions()`의 위임 리스너 한 곳에서 처리(로그인 버튼 포함). 리스너의 `try/catch`는 유지.
- 저장은 `persist*` / `delete*Remote` 함수와 `safePersist(fn)`을 거친다. 저장 실패해도 화면 갱신 코드는 실행되어야 한다.
- 저장소 접근은 `makeFirestoreAdapter(fs, fdb, base)`가 만든 인터페이스(`db.collection(name).onSnapshot / doc(id).set / delete / get`, `db.doc(path)`)만 쓴다.
  `state.db`는 `users/{uid}` 기준, `state.rootDb`는 최상위(legacy 가져오기·`users/{uid}` 문서 전용). `onSnapshot`으로 받은 데이터는 `unfreeze()`를 거쳐 상태에 넣는다.
- 실시간 구독은 `startUserData()`에서 `_unsubs`에 넣고, 로그아웃/계정 변경 시 `stopUserData()`로 전부 해제 + 상태 초기화한다.
- **하위 호환:** 새 필드는 선택값으로 만들고, 그 필드가 없는 기존 문서도 에러 없이 보여야 한다.
- **새 Firestore 컬렉션/문서 경로를 쓰면 `firestore.rules`에도 추가**해야 한다(개인 데이터는 `users/{uid}/` 아래면 이미 허용됨).
  규칙은 GitHub에 올려도 자동 적용되지 않으므로, 사용자에게 "Firebase 콘솔 → Firestore → 규칙 탭에 붙여넣고 게시"를 꼭 안내할 것.
- 그룹 규칙(참여·나가기·내보내기·이름 변경·삭제 권한)은 `firestore.rules`에만 있다. 앱에서 그룹 문서를 바꾸는 방식을 바꾸면 규칙과 `tests/firestore-rules.test.js`도 함께 확인할 것.
- 전환 기간 블록(legacy 경로)은 **1단계(로그인한 사람만 읽기 전용)가 적용된 상태**. 남은 건 2단계(콘솔에서 legacy 데이터 삭제 → `firestore.rules.final` 게시 → 저장소에서 `.final`을 `firestore.rules`로 교체). legacy에 쓰는 코드는 만들지 않는다(규칙이 거부함).
  legacy를 읽을 수 없어도(규칙 삭제 후) 앱은 정상 동작해야 한다(`tests/stability.test.js` 5번).
- 저장소에 예시 데이터를 자동으로 쓰지 않는다(예시는 설정값이 없을 때의 미리보기 모드에서만 화면에 채움).
- Home 위젯 켜기/끄기는 계정(`users/{uid}/settings/app.homeWidgets`)에 저장. 예전 기기 값(`localStorage` `campbase.homeWidgets`)은 계정 값이 없을 때의 기본값으로만 읽는다.
- Camping 탭의 분류는 지역(`regionOf()`)이다. Home의 캠핑 통계도 같은 기준이어야 `home-cat-nav` 이동이 맞는다.
- Firebase SDK 버전을 바꿀 때는 `docs/index.html`의 `FIREBASE_SDK_VERSION`, 워크플로의 `V=`, `package.json`의 `firebase` 세 곳을 같이 바꾼다.
- `keystore/debug.keystore`는 **절대** 바꾸지 않는다(SHA-1 `9F:9E:A1:…:7E:11:9D`가 Firebase·google-services.json에 등록돼 있음. 바꾸면 구글 로그인과 덮어 설치가 모두 깨짐).
  서명은 워크플로가 `android/app/build.gradle`에 `signingConfigs.debug`(이 파일 직접 지정)를 덧붙여서 한다. `~/.android/debug.keystore`에 복사하는 방식은 Actions에서 무시돼 build-9까지 매번 다른 키로 서명됐었다. 빌드 후 APK의 SHA-1을 검사해 다르면 빌드를 멈춘다.
- `window.__FIREBASE_MODULES__`(가짜 SDK 주입)와 `window.__FIREBASE_EMULATOR__`(에뮬레이터 연결)는 테스트 전용 훅이다. 지우지 말 것.

## 테스트 (변경할 때마다 아래 열다섯 개는 꼭 실행(`npm test`), 새 기능에는 테스트 추가)
```
node tests/shared-app.test.js   # 로그인 화면/로그인 유지/로그아웃, 사용자 A·B 개인 공간 분리, 같은 계정 두 기기 실시간 동기화,
                                # 위젯(계정 기준), 백업, legacy 가져오기(중복 건너뛰기), APK 네이티브 로그인 경로, 오프라인/권한/미리보기 모드,
                                # 항목 추가(이름·개수, 소분류 칸 없음)·이름·개수 고치기, 리스트 접기(기억)
node tests/smoke.test.js        # 로그인 후 모든 탭의 주요 동작 클릭 스모크 테스트 + 로그아웃
node tests/groups.test.js       # 그룹: 만들기·초대 코드·참여·함께 체크·공간 전환·담당자·장비 주인·보내기·만료 코드·내보내기·나가기·이름 변경·삭제
node tests/stability.test.js    # 삭제 되돌리기(개인/그룹, 필드 보존), 그룹 백업 왕복·잘못된 파일 거부, 새 버전 배너(APK)·앱 버전, legacy 닫힘에도 정상 동작
node tests/trips.test.js        # 캠핑 일정: 개인/그룹 만들기·수정·삭제(되돌리기), 템플릿 복사·연결·빈 리스트, 필터·진행률·내 담당, Home 다음 캠핑, 지난 일정 화면, 후기 남기기(tripRef),
                                # Camping의 지난 일정 후기 카드·기록 추가의 "지난 일정에서 불러오기"(이름·공유·tripRef)
node tests/gear-checklist.test.js  # 장비↔준비물: 담당자 추천(일치·불일치·주인 없음), 장비→체크리스트(개인/그룹, 중복 건너뛰기, 주인 자동 담당)
node tests/ui.test.js           # 화면 규칙: 하단 탭바(390px)·본문 안 가림·키보드, ⋯ 메뉴(열기·바깥/Esc 닫기·키보드), 모달(X·Esc·배경·초점), 초점 표시, 앰버·대비
node tests/reviews.test.js      # 그룹 후기 공유: 공유·수정·끄기·삭제·되돌리기 사본 동기화, 여러 그룹, 캠핑장별 묶음·평균·요약, 일정 후기 기본 공유, 내리기, 나간 멤버, 비멤버, 백업 후 맞춤,
                                # 멤버 함께 고치기(작성자 기록·다른 그룹 반영), 그룹 화면 기록 추가, 샤워장, 후기 펼치기, "전체" 개수
node tests/ui-f.test.js         # 화면 보완(F): 390px 마지막 항목 ⋯ 메뉴, 선택 목록 정렬, 후기 카드 이름, 일정 패널·sticky 요약·첫 항목 위치, 체크 버튼 40×40, 그룹 안내 1회,
                                # Gear 선택 모드·0개 칩, Cooking 레시피 탭 없음(재료 체크 없음), 모바일 시트·고정 버튼 바, 별점, Home 막대(390)/원형(1280), 최대 폭, 닫기 버튼 없음
node tests/template-k.test.js   # 템플릿 하위 메뉴(데스크톱, 화살표로 펼치기/접기·기억)·휴대폰 칩·다른 기기 반영, 새 템플릿을 장비에서 고르기(기본)·직접 입력, 템플릿에 장비 더 불러오기, 그룹
node tests/template-j.test.js   # 템플릿 페이지(리스트 없이 만들기·항목·되돌리기, 그룹은 만든 사람만), 새 리스트에서 템플릿, Gear 카테고리별 +, Home 장비 통계 없음
node tests/gear-i.test.js       # Gear 수정(I): 장비 X 삭제(맨 아래도 눌림·되돌리기), 카테고리별 전체 선택(mixed), 카테고리 관리 버튼 위치
node tests/trip-gear-h.test.js  # 일정 → 장비에서 불러오기(전체·묶음 선택, 이미 있는 항목 제외, 그룹/내 장비 담당자), 일정 메모(Description)
node tests/meals.test.js        # 식단·장보기: 끼니 칸(2박·1박·당일), 메뉴 넣기·옮기기·빼기(되돌리기)·끼니 추가·인원·다 먹었어요·날짜 밖, 양 계산(배수·끼니별·합산·올림·단위·적당량),
                                # 장보기 만들기·Checklist 표시·자동 맞춤(체크·담당·고친 양·집에 있음·직접 추가 유지, 빠진 재료), 그룹(실시간·담당·동시 수정·공간과 무관 저장),
                                # 일정 패널·Home·지난 일정 연결, 레시피 탭 없음·메뉴 직접 입력(이름·재료 → 장보기, 고치기), 일정 삭제 되돌리기·백업 왕복·예전 백업, 일정 없음 안내
node tests/gear-g.test.js       # Gear 보완(G): 글꼴 통일, 카테고리 순서·대분류/소분류·설명, 기본값 잠금 없음, 브랜드 직접 입력, 메모, 묶음 접기, 고른 카테고리 기본값, 그룹 대분류
```
- `playwright`가 필요하다. 없으면 `npm i --no-save playwright` 후, 브라우저가 없으면 `npx playwright install chromium`. 크롬 경로는 `CHROMIUM_PATH`.
- 테스트마다 `python3 -m http.server`를 고정 포트(8765~8778·8780~8782, 스크린샷 8779)로 띄운다(끝날 때 `process.on('exit')`로 서버 종료). 테스트를 강제로 멈추면(timeout 등) 서버가 남아서 **다음 실행이 예전 코드를 받는다** → `pgrep -fa http.server`로 확인해서 정리.
- 테스트는 `docs/`를 임시 폴더에 복사하고 테스트용 설정값으로 바꿔서 실행하므로 실제 Firebase에 접속하지 않는다.
- 가짜 SDK(`tests/fake-firestore.js`)는 Auth(로그인 사용자 주입, localStorage 유지), `query/where`, `updateDoc`(arrayUnion 등), 규칙(users/{uid}는 본인만, 그룹 규칙)도 흉내 낸다.
- 규칙·실제 SDK 테스트(Java 11+ 필요, Firebase 에뮬레이터):
  ```
  npm i --no-save playwright firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10.12.2
  npx firebase emulators:exec --only firestore,auth --project demo-campbase "node tests/firestore-rules.test.js && node tests/emulator-e2e.test.js"
  ```
  `firestore.rules`를 바꾸면 이것도 실행(규칙 테스트는 `firestore.rules.final`도 함께 검사). e2e는 진짜 SDK(`vendor/` 방식) + 네이티브 로그인 흉내로 앱을 끝까지 돌린다.
- 실제 안드로이드 빌드·네이티브 구글 로그인은 GitHub Actions + 실제 폰에서만 확인할 수 있다. push 후 Actions 결과를 확인할 것.

## 참고
- 예전에 claude.ai 아티팩트로 만든 버전(Version 19)이 따로 있지만, 지금은 이 저장소가 기준(주 버전)이다. 데이터도 서로 다르다.
