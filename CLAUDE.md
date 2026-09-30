# 캠프베이스 (CampBase) — 작업 안내

구글 계정으로 로그인해서 쓰는 캠핑 앱. 사람마다 개인 공간에 저장되고, 같은 계정으로 로그인한 기기끼리는 바로 동기화된다.
(그룹 공유 기능은 다음 단계 예정 — 아직 없음)
사용자는 비개발자에 가깝다. **한국어로, 쉬운 말로** 설명하고, 바뀐 점과 설치 방법을 짧게 알려줄 것.

## 앱의 목적 (새 기능은 이 세 가지에 도움이 되는지로 판단)
1. 캠핑 갈 때 준비할 것 챙기기 — Checklist 탭
2. 내가 가진 캠핑 장비 조회 — Gear 탭
3. 다녀온 캠핑장 후기 남기기(사이트 크기, 화장실·매점 상태, 체크인/아웃 시간 등) — Camping 탭

## 구조
- `docs/index.html` — 앱 전체(HTML+CSS+JS 한 파일, 바닐라 JS, 빌드 도구 없음). 로그인 화면(`#login-screen`) + 탭: Home / Camping / Gear / Checklist / Cooking / Settings.
- `docs/firebase-config.js` — Firebase 프로젝트 `campbase-f5df5` 연결값(비밀 아님).
- `docs/sw.js`, `docs/manifest.webmanifest`, `docs/icons/` — 웹(홈 화면 설치)용.
- `firestore.rules` — Firestore 보안 규칙. `users/{uid}/**`는 본인만, 최상위 legacy 경로는 "전환 기간" 블록으로 열어둠, 나머지는 거부.
- `firebase.json` — 에뮬레이터(규칙 테스트)용 설정. 실제 배포에는 쓰지 않음.
- `capacitor.config.json`, `package.json`, `assets/`, `keystore/` — 안드로이드 APK 빌드용(Capacitor 6 + `@capacitor-firebase/authentication` 6.x, `skipNativeAuth: true`).
- `android-config/google-services.json` — APK 구글 로그인용. 워크플로가 `android/app/`로 복사한다.
- `.github/workflows/build-apk.yml` — 모든 브랜치/PR에서 APK 빌드 → Actions Artifacts. **main일 때만** Releases에 올림.
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
  - `users/{uid}/settings/app` — `{ gearCategories, weatherLocation, homeWidgets }` (Home 위젯도 계정 기준)
- 최상위 `campingLogs/gear/checklists/cookingChecks`, `app/settings`는 **예전 공유 저장소(legacy)**. 새 앱은
  Settings → "기존 공유 데이터 가져오기"에서 **읽기만** 한다(내 공간으로 복사, 같은 id는 건너뜀, 원본 유지).
- 설정값이 비어 있으면 미리보기 모드(로그인 없음, 예시 데이터, 저장 안 함).

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
- 전환 기간 블록(legacy 경로)은 나중에 "로그인한 사람만 읽기 전용 → 삭제" 순서로 닫는다(파일 안 주석 참고). 그 전에 legacy에 새로 쓰는 코드는 만들지 않는다.
- 저장소에 예시 데이터를 자동으로 쓰지 않는다(예시는 설정값이 없을 때의 미리보기 모드에서만 화면에 채움).
- Home 위젯 켜기/끄기는 계정(`users/{uid}/settings/app.homeWidgets`)에 저장. 예전 기기 값(`localStorage` `campbase.homeWidgets`)은 계정 값이 없을 때의 기본값으로만 읽는다.
- Camping 탭의 분류는 지역(`regionOf()`)이다. Home의 캠핑 통계도 같은 기준이어야 `home-cat-nav` 이동이 맞는다.
- Firebase SDK 버전을 바꿀 때는 `docs/index.html`의 `FIREBASE_SDK_VERSION`, 워크플로의 `V=`, `package.json`의 `firebase` 세 곳을 같이 바꾼다.
- `keystore/debug.keystore`는 **절대** 바꾸지 않는다(SHA-1 `9F:9E:A1:…:7E:11:9D`가 Firebase·google-services.json에 등록돼 있음. 바꾸면 구글 로그인과 덮어 설치가 모두 깨짐).
- `window.__FIREBASE_MODULES__`(가짜 SDK 주입)와 `window.__FIREBASE_EMULATOR__`(에뮬레이터 연결)는 테스트 전용 훅이다. 지우지 말 것.

## 테스트 (변경할 때마다 앞의 둘은 꼭 실행, 새 기능에는 테스트 추가)
```
node tests/shared-app.test.js   # 로그인 화면/로그인 유지/로그아웃, 사용자 A·B 개인 공간 분리, 같은 계정 두 기기 실시간 동기화,
                                # 위젯(계정 기준), 백업, legacy 가져오기(중복 건너뛰기), APK 네이티브 로그인 경로, 오프라인/권한/미리보기 모드
node tests/smoke.test.js        # 로그인 후 모든 탭의 주요 동작 클릭 스모크 테스트 + 로그아웃
```
- `playwright`가 필요하다. 없으면 `npm i --no-save playwright` 후, 브라우저가 없으면 `npx playwright install chromium`. 크롬 경로는 `CHROMIUM_PATH`.
- 테스트는 `docs/`를 임시 폴더에 복사하고 테스트용 설정값으로 바꿔서 실행하므로 실제 Firebase에 접속하지 않는다.
- 가짜 SDK(`tests/fake-firestore.js`)는 Auth(로그인 사용자 주입, localStorage 유지)와 규칙(users/{uid}는 본인만)도 흉내 낸다.
- 규칙·실제 SDK 테스트(Java 11+ 필요, Firebase 에뮬레이터):
  ```
  npm i --no-save playwright firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10.12.2
  npx firebase emulators:exec --only firestore,auth --project demo-campbase "node tests/firestore-rules.test.js && node tests/emulator-e2e.test.js"
  ```
  `firestore.rules`를 바꾸면 이것도 실행. e2e는 진짜 SDK(`vendor/` 방식) + 네이티브 로그인 흉내로 앱을 끝까지 돌린다.
- 실제 안드로이드 빌드·네이티브 구글 로그인은 GitHub Actions + 실제 폰에서만 확인할 수 있다. push 후 Actions 결과를 확인할 것.

## 참고
- 예전에 claude.ai 아티팩트로 만든 버전(Version 19)이 따로 있지만, 지금은 이 저장소가 기준(주 버전)이다. 데이터도 서로 다르다.
