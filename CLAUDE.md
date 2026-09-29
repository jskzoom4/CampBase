# 캠프베이스 (CampBase) — 작업 안내

친구들이 함께 쓰는 캠핑 앱. 한 사람이 준비물을 체크하거나 기록을 남기면 모두의 화면에 바로 반영된다.
사용자는 비개발자에 가깝다. **한국어로, 쉬운 말로** 설명하고, 바뀐 점과 설치 방법을 짧게 알려줄 것.

## 앱의 목적 (새 기능은 이 세 가지에 도움이 되는지로 판단)
1. 캠핑 갈 때 준비할 것 챙기기 — Checklist 탭
2. 내가 가진 캠핑 장비 조회 — Gear 탭
3. 다녀온 캠핑장 후기 남기기(사이트 크기, 화장실·매점 상태, 체크인/아웃 시간 등) — Camping 탭

## 구조
- `docs/index.html` — 앱 전체(HTML+CSS+JS 한 파일, 바닐라 JS, 빌드 도구 없음). 탭: Home / Camping / Gear / Checklist / Cooking / Settings.
- `docs/firebase-config.js` — Firebase 프로젝트 `campbase-f5df5` 연결값(비밀 아님).
- `docs/sw.js`, `docs/manifest.webmanifest`, `docs/icons/` — 웹(홈 화면 설치)용.
- `firestore.rules` — Firestore 보안 규칙. 로그인 없이 누구나 읽기/쓰기, 앱이 쓰는 경로만 열어둠.
- `capacitor.config.json`, `package.json`, `assets/`, `keystore/` — 안드로이드 APK 빌드용(Capacitor 6).
- `.github/workflows/build-apk.yml` — main에 push되면 APK를 빌드해 Releases에 올림.
- `tests/` — 가짜 Firestore로 돌리는 자동 테스트.

## 배포 흐름
main 브랜치에 반영 → GitHub Actions가 APK 자동 빌드(5~10분) → Releases에 `campbase.apk` 게시.
- 친구 공유 링크(항상 최신): `https://github.com/jskzoom4/CampBase/releases/latest/download/campbase.apk`
- 폰에서는 같은 링크로 받아 덮어 설치하면 됨(서명키 고정, 데이터는 Firebase에 있어 유지).
- GitHub Pages(main `/docs`)를 켜면 아이폰용 웹 주소 `https://jskzoom4.github.io/CampBase/`.
- 되돌리기: 문제가 된 변경을 revert하면 다시 빌드됨. 예전 APK도 Releases에 남아 있음.

## 꼭 지킬 규칙
- **네이티브 `alert` / `confirm` / `prompt` 금지.** 확인이 필요하면 `confirmModal(message, label, onConfirm)`을 쓴다.
- 클릭/변경 이벤트는 `data-action` 속성 + `wireGlobalActions()`의 위임 리스너 한 곳에서 처리. 리스너의 `try/catch`는 유지.
- 저장은 `persist*` / `delete*Remote` 함수와 `safePersist(fn)`을 거친다. 저장 실패해도 화면 갱신 코드는 실행되어야 한다.
- 저장소 접근은 `makeFirestoreAdapter()`가 만든 인터페이스(`db.collection(name).onSnapshot / doc(id).set / delete / get`, `db.doc(path)`)만 쓴다. `onSnapshot`으로 받은 데이터는 `unfreeze()`를 거쳐 상태에 넣는다.
- **하위 호환:** 새 필드는 선택값으로 만들고, 그 필드가 없는 기존 문서도 에러 없이 보여야 한다.
- **새 Firestore 컬렉션/문서 경로를 쓰면 `firestore.rules`에도 추가**해야 한다. 규칙은 GitHub에 올려도 자동 적용되지 않으므로, 사용자에게 "Firebase 콘솔 → Firestore → 규칙 탭에 붙여넣고 게시"를 꼭 안내할 것.
- 공유 저장소에 예시 데이터를 자동으로 쓰지 않는다(예시는 설정값이 없을 때의 미리보기 모드에서만 화면에 채움).
- Home 위젯 켜기/끄기는 기기별(`localStorage` `campbase.homeWidgets`)이다. 공유 저장소 `app/settings`에는 `weatherLocation`, `gearCategories`만 저장.
- Camping 탭의 분류는 지역(`regionOf()`)이다. Home의 캠핑 통계도 같은 기준이어야 `home-cat-nav` 이동이 맞는다.
- Firebase SDK 버전을 바꿀 때는 `docs/index.html`의 `FIREBASE_SDK_VERSION`과 워크플로의 `V=` 두 곳을 같이 바꾼다.
- `keystore/debug.keystore`는 바꾸지 않는다(바꾸면 기존 설치 위에 업데이트가 안 됨).

## 테스트 (변경할 때마다 둘 다 실행, 새 기능에는 테스트 추가)
```
node tests/shared-app.test.js   # 두 기기 간 실시간 공유, 체크, 백업, 오프라인/권한/미리보기 모드
node tests/smoke.test.js        # 모든 탭의 주요 동작 클릭 스모크 테스트
```
- `playwright`가 필요하다. 없으면 `npm i --no-save playwright` 후, 브라우저가 없으면 `npx playwright install chromium`.
- 크롬 경로를 지정하려면 `CHROMIUM_PATH` 환경변수.
- 테스트는 `docs/`를 임시 폴더에 복사하고 테스트용 설정값으로 바꿔서 실행하므로 실제 Firebase에 접속하지 않는다.
- 실제 안드로이드 빌드는 GitHub Actions에서만 확인할 수 있다. push 후 Actions 결과를 확인할 것.

## 참고
- 예전에 claude.ai 아티팩트로 만든 버전(Version 19)이 따로 있지만, 지금은 이 저장소가 기준(주 버전)이다. 데이터도 서로 다르다.
