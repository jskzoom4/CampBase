# 캠프베이스 (CampBase) — 작업 안내

구글 계정으로 로그인해서 쓰는 캠핑 앱. 사람마다 개인 공간에 저장되고, 같은 계정으로 로그인한 기기끼리는 바로 동기화된다.
**그룹**을 만들면 멤버끼리 Checklist·Gear를 함께 보고 고치고, Camping 탭에서는 멤버가 공유한 후기를 **읽기 전용**으로 본다(초대 코드로 참여).
원칙: **그룹은 Checklist·Gear(함께 편집) + Camping 읽기 전용 후기.** 후기 작성·수정·삭제는 항상 내 개인 기록에서만.
사용자는 비개발자에 가깝다. **한국어로, 쉬운 말로** 설명하고, 바뀐 점과 설치 방법을 짧게 알려줄 것.

## 앱의 목적 (새 기능은 이 세 가지에 도움이 되는지로 판단)
1. 캠핑 갈 때 준비할 것 챙기기 — Checklist 탭
2. 내가 가진 캠핑 장비 조회 — Gear 탭
3. 다녀온 캠핑장 후기 남기기(사이트 크기, 화장실·매점 상태, 체크인/아웃 시간 등) — Camping 탭

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
  - `users/{uid}/campingLogs|gear|checklists|cookingChecks/{id}`
  - `users/{uid}/trips/{id}`, `users/{uid}/checklistTemplates/{id}` — 캠핑 일정·체크리스트 템플릿(아래 "캠핑 일정")
  - `users/{uid}/settings/app` — `{ gearCategories, weatherLocation, homeWidgets }` (Home 위젯도 계정 기준. `weatherLocation`은 지금 화면에서 안 씀 — 날씨 기능용으로 남겨 둠)
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
  `{ title, startDate, endDate (YYYY-MM-DD), campsiteName, region, memberUids(그룹만, 참가 멤버), createdBy, createdAt, updatedBy }`. 저장은 `persistTrip()`.
- 체크리스트의 선택 필드 `tripId` = 연결된 일정. 없는 리스트도 그대로 보인다. 일정을 보는 중에 만든 새 리스트는 그 일정에 연결.
- 템플릿: `users/{uid}/checklistTemplates/{id}`, `groups/{gid}/checklistTemplates/{id}` = `{ title, items:[{ label, group }] }`(체크 상태·담당자 없음).
  리스트 헤더 `cl-save-template`로 저장, 이름 변경·삭제(되돌리기)는 일정 만들기 창 안(`refreshTripModalTemplates()`).
- Checklist 탭: `spaceChipsHtml()` 아래 `tripBarHtml()`(전체 | 일정… | 지난 일정 ▾ | + 일정 만들기). `state.tripFilter`('all' 또는 일정 id), `state.showPastTrips`. 공간을 바꾸면 둘 다 초기화.
  일정을 고르면 `tripCardHtml()`(날짜, D-n/진행 중/끝남, 캠핑장·지역, 참가 멤버, 진행률 `tripProgress()` = 연결된 리스트 항목 중 결정된 것/전체, 그룹이면 내 담당 남은 개수) + 연결된 리스트만.
- 일정 만들기 `tripFormModal()` → `saveTripForm()`: 체크리스트 시작 방법 = 템플릿 복사(새 리스트, 항목 모두 미정) / 기존 리스트 연결 / 빈 리스트("이름 준비물").
- 일정 삭제(`deleteTripConfirm`)는 연결된 리스트를 지우지 않고 `tripId`만 해제, 되돌리면 일정과 연결 모두 복구(`deleteDocWithUndo`의 `after`).
- 그룹 일정은 Home 카드 때문에 **내 모든 그룹**의 trips·checklists를 늘 구독한다(`syncGroupBackground()` → `state.groupTrips[gid]`, `state.groupTripLists[gid]`). 그룹 공간의 `SP.trips`도 여기서 읽는다.
  선택한 그룹의 템플릿은 `startSpaceData()`에서 `state.groupTemplates`로.
- Home "다음 캠핑" 카드(`nextTripHtml()`, 위젯 키 `nextTrip` — 예전 `location` 값을 `normalizeHomeWidgets()`가 이어받음): 개인 일정 + 내가 참가하는 그룹 일정 중
  가장 가까운 다가오는/진행 중 일정 1개. 누르면 그 공간의 Checklist 탭에서 그 일정 선택(`openTripFromHome`). 없으면 "다음 캠핑 일정을 만들어보세요".
  끝난 지 7일 이내이고 내 후기가 없는 일정은 "'이름' 후기를 남겨보세요". Home의 다른 통계는 개인 데이터만.
- 후기 남기기: 끝난 일정 카드의 `trip-review` → **내 개인** 캠핑 기록 폼을 캠핑장 이름·지역·시작일로 미리 채움(`campFormModal(null, prefill)`),
  저장하면 캠핑 기록에 선택 필드 `tripRef: { space: 'me'|gid, tripId }`. `hasMyReview()`로 "내 후기 작성함" 표시. 기록 수정(`saveCampForm`)은 기존 필드(tripRef 등)를 유지.
- 개인 백업에 `trips`, `checklistTemplates` 포함(필드가 없는 예전 백업을 가져오면 지금 일정·템플릿은 그대로 둔다).

## 그룹 후기 공유 (Camping 탭, 읽기 전용)
- 개인 캠핑 기록의 선택 필드 `sharedGroupIds: [gid, ...]`(없으면 공유 안 함). 공유한 그룹마다 사본
  `groups/{gid}/sharedReviews/{내uid}_{기록id}` = 후기 필드(`REVIEW_FIELDS`: name, date, region, siteType, siteSize, rating, checkinTime, checkoutTime, toiletCondition, storeCondition, notes, tripRef) + `{ authorUid, sourceLogId, updatedAt }`.
- 동기화는 **`syncReviewCopies(prev, next)`** 하나로(켠 그룹 저장·갱신, 끈 그룹 삭제, next=null이면 모두 삭제): 기록 저장(`saveCampForm`), 삭제(+되돌리기 때 다시 만들기), 개인 백업 가져오기 후.
  개인 기록을 바꾸는 새 코드를 만들면 이 함수도 불러야 한다.
- 없어진 그룹(삭제·나감)의 gid는 `cleanupSharedGroupIds()`가 내 기록에서 조용히 지운다 — 그룹 목록을 **서버에서** 받은 뒤에만(`state.groupsServerLoaded`, 어댑터 `wrapQuery`의 `fromCache`).
  그룹을 나가도 내가 올린 사본은 그룹에 남는다(작성자는 나간 뒤에도 규칙상 자기 사본 삭제 가능). 그룹 삭제 시 `sharedReviews`도 함께 삭제. 그룹 백업에는 넣지 않음.
- 규칙(`firestore.rules`의 `sharedReviews` 블록): 읽기 = 멤버, 만들기·수정 = 멤버 + `authorUid == 나` + 문서 id `== 나_sourceLogId`(작성자 변경 불가), 삭제 = 작성자 본인 또는 그룹장.
  `sharedReviews`는 일반 하위 컬렉션 허용 목록(`GROUP_SUBCOLLECTIONS`)에 **넣지 않는다**(넣으면 아무 멤버나 쓸 수 있게 됨).
- 기록 폼의 "그룹에 공유" 칩(`_campShare`, `cf-share-toggle`): 기본 꺼짐, 그룹 일정에서 "후기 남기기"로 온 새 기록은 그 그룹이 켜짐. 목록에 "○○ 공유" 태그.
- Camping 탭 위쪽 보기 전환 `[내 기록 | 그룹A 후기 | …]`: `state.campView`('me' 또는 gid, 기기별 `localStorage` `campbase.campView.<uid>`, Checklist·Gear 공간과 따로).
  그룹 보기는 `startReviewData()`로 그 그룹의 `sharedReviews`만 구독 → `renderGroupReviews()`: 캠핑장별 카드(`groupReviewCards`, `normName`으로 묶음 — 후기 수, 평균 평점, 최근 방문일, 작성자 사진, 화장실·매점 최빈값),
  지역 필터·정렬(최신순·평점순). 카드 → `reviewDetailModal()`(멤버별 후기, 내 것엔 "내 기록에서 수정", 그룹장에겐 남의 후기 "그룹에서 내리기"(confirmModal, 되돌리기 없음 — 그룹장은 남의 사본을 다시 만들 수 없음)). 나간 멤버는 "나간 멤버".
- Home 통계는 개인 기록만.

## 그룹
- `groups/{gid}` = `{ name, ownerUid, memberUids: [...], members: { uid: { name, photoURL, role: 'owner'|'member' } }, createdAt, gearCategories, joinCode? }`
  - `groups/{gid}/checklists|gear|trips|checklistTemplates/{id}` — 멤버 모두 읽기·쓰기(규칙은 이 네 하위 컬렉션만 허용 = 앱의 `GROUP_SUBCOLLECTIONS`. 새 하위 컬렉션을 쓰려면 규칙·`.final`·가짜 SDK의 `GROUP_SUBS`에 추가). 그룹 공간에서 저장하면 `addedBy`(처음 만든 사람)·`updatedBy`(마지막 수정) uid를 남긴다.
  - 그룹 장비 카테고리는 `groups/{gid}.gearCategories`(없으면 기본 목록).
  - 내 그룹 목록: `state.rootDb.collection('groups').where('memberUids','array-contains', uid)` 실시간 구독 → `state.groups`.
- `groupInvites/{code}` = `{ gid, groupName, createdBy, expiresAt(밀리초 숫자), createdAt }`. 코드는 6자리, 문자 `INVITE_CHARS`(0/O/1/I 제외), 7일 만료.
- 참여: `groups/{gid}`에 `update({ memberUids: arrayUnion(나), 'members.나': {...role:'member'}, joinCode: 코드 })` — 규칙이 `joinCode`로 초대 코드(같은 gid, 만료 전)를 `get()`해서 확인한다.
  나가기/내보내기는 `arrayRemove` + `deleteField()`. 그룹장은 나갈 수 없고 삭제만(하위 데이터(`GROUP_SUBCOLLECTIONS` 전부) → 초대 코드 → 그룹 문서 순서로 삭제).
- **공간 전환은 Checklist·Gear 탭에만**(일정·템플릿도 Checklist 탭의 지금 공간 기준) (`spaceChipsHtml()`, `state.space` = `'me'` 또는 gid, 기기별 `localStorage` `campbase.space.<uid>`).
  Home·Camping(내 기록)·Cooking·Settings·백업·legacy 가져오기는 항상 개인 공간(`state.db`, `state.checklists`, `state.gear`). Camping의 그룹 후기 보기는 위 "그룹 후기 공유"(따로 전환).
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

## 배포 흐름
- 브랜치/PR에 push → GitHub Actions가 APK 빌드(5~10분) → 그 실행 화면 아래 **Artifacts**(`campbase-apk-번호`, zip)에서 받아 폰에서 테스트.
- main에 반영 → 같은 빌드 + Releases에 `campbase.apk` 게시.
- 친구 공유 링크(항상 최신, main 빌드만): `https://github.com/jskzoom4/CampBase/releases/latest/download/campbase.apk`
- 폰에서는 같은 링크로 받아 덮어 설치하면 됨(서명키 고정, 데이터는 Firebase에 있어 유지).
- GitHub Pages(main `/docs`)를 켜면 아이폰용 웹 주소 `https://jskzoom4.github.io/CampBase/`.
  웹 로그인이 되려면 Firebase 콘솔 → Authentication → 설정 → 승인된 도메인에 `jskzoom4.github.io`가 있어야 한다.
- 되돌리기: 문제가 된 변경을 revert하면 다시 빌드됨. 예전 APK도 Releases에 남아 있음.

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

## 테스트 (변경할 때마다 아래 일곱 개는 꼭 실행(`npm test`), 새 기능에는 테스트 추가)
```
node tests/shared-app.test.js   # 로그인 화면/로그인 유지/로그아웃, 사용자 A·B 개인 공간 분리, 같은 계정 두 기기 실시간 동기화,
                                # 위젯(계정 기준), 백업, legacy 가져오기(중복 건너뛰기), APK 네이티브 로그인 경로, 오프라인/권한/미리보기 모드
node tests/smoke.test.js        # 로그인 후 모든 탭의 주요 동작 클릭 스모크 테스트 + 로그아웃
node tests/groups.test.js       # 그룹: 만들기·초대 코드·참여·함께 체크·공간 전환·담당자·장비 주인·보내기·만료 코드·내보내기·나가기·이름 변경·삭제
node tests/stability.test.js    # 삭제 되돌리기(개인/그룹, 필드 보존), 그룹 백업 왕복·잘못된 파일 거부, 새 버전 배너(APK)·앱 버전, legacy 닫힘에도 정상 동작
node tests/trips.test.js        # 캠핑 일정: 개인/그룹 만들기·수정·삭제(되돌리기), 템플릿 복사·연결·빈 리스트, 필터·진행률·내 담당, Home 다음 캠핑, 후기 남기기(tripRef)
node tests/gear-checklist.test.js  # 장비↔준비물: 담당자 추천(일치·불일치·주인 없음), 장비→체크리스트(개인/그룹, 중복 건너뛰기, 주인 자동 담당)
node tests/reviews.test.js      # 그룹 후기 공유: 공유·수정·끄기·삭제·되돌리기 사본 동기화, 여러 그룹, 캠핑장별 묶음·평균·요약, 일정 후기 기본 공유, 내리기, 나간 멤버, 비멤버, 백업 후 맞춤
```
- `playwright`가 필요하다. 없으면 `npm i --no-save playwright` 후, 브라우저가 없으면 `npx playwright install chromium`. 크롬 경로는 `CHROMIUM_PATH`.
- 테스트마다 `python3 -m http.server`를 고정 포트(8765~8773)로 띄운다. 테스트를 강제로 멈추면(timeout 등) 서버가 남아서 **다음 실행이 예전 코드를 받는다** → `pgrep -fa http.server`로 확인해서 정리.
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
