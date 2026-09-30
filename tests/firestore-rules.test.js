// firestore.rules 테스트 — 진짜 Firestore 에뮬레이터 + @firebase/rules-unit-testing.
// 실행(저장소 루트에서, Java 11 이상 필요):
//   npm i --no-save firebase-tools@13 @firebase/rules-unit-testing@3
//   npx firebase emulators:exec --only firestore,auth --project demo-campbase "node tests/firestore-rules.test.js"
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, collection, getDocs, setLogLevel } = require('firebase/firestore');
setLogLevel('silent');   // 거부될 때마다 찍히는 SDK 경고는 숨김(거부가 기대값인 테스트가 많음)

const results = [];
async function check(name, p) {
  try { await p; results.push(true); console.log('PASS ' + name); }
  catch (e) { results.push(false); console.log('FAIL ' + name + '  → ' + (e && e.message)); }
}

(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  const env = await initializeTestEnvironment({
    projectId: 'demo-campbase',
    firestore: { host, port: Number(port), rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
  });
  await env.clearFirestore();
  // 규칙을 거치지 않고 미리 넣어둘 데이터
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/alice'), { name: '앨리스', email: 'a@example.com' });
    await setDoc(doc(db, 'users/alice/gear/g1'), { name: '텐트' });
    await setDoc(doc(db, 'users/alice/settings/app'), { gearCategories: ['텐트', '기타'] });
    await setDoc(doc(db, 'gear/legacy1'), { name: '예전 공유 장비' });
    await setDoc(doc(db, 'app/settings'), { gearCategories: ['텐트'] });
    await setDoc(doc(db, 'secret/x'), { v: 1 });
  });

  const alice = env.authenticatedContext('alice').firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const anon = env.unauthenticatedContext().firestore();

  // 1. 개인 공간: 본인만
  await check('본인: users/{uid} 계정 문서 읽기·쓰기', Promise.all([
    assertSucceeds(getDoc(doc(alice, 'users/alice'))),
    assertSucceeds(setDoc(doc(alice, 'users/alice'), { name: '앨리스', email: 'a@example.com', photoURL: '', updatedAt: 'now' })),
  ]));
  for (const c of ['campingLogs', 'gear', 'checklists', 'cookingChecks']) {
    await check(`본인: users/{uid}/${c} 읽기·쓰기·삭제`, (async () => {
      await assertSucceeds(setDoc(doc(alice, `users/alice/${c}/t1`), { v: 1 }));
      await assertSucceeds(getDocs(collection(alice, `users/alice/${c}`)));
      await assertSucceeds(deleteDoc(doc(alice, `users/alice/${c}/t1`)));
    })());
  }
  await check('본인: users/{uid}/settings/app 읽기·쓰기', Promise.all([
    assertSucceeds(getDoc(doc(alice, 'users/alice/settings/app'))),
    assertSucceeds(setDoc(doc(alice, 'users/alice/settings/app'), { gearCategories: ['기타'], weatherLocation: null, homeWidgets: { gear: false } })),
  ]));
  await check('남(bob): alice 계정 문서 읽기 거부', assertFails(getDoc(doc(bob, 'users/alice'))));
  await check('남(bob): alice 계정 문서 쓰기 거부', assertFails(setDoc(doc(bob, 'users/alice'), { name: 'x' })));
  await check('남(bob): alice 장비 목록 읽기 거부', assertFails(getDocs(collection(bob, 'users/alice/gear'))));
  await check('남(bob): alice 장비 한 개 읽기 거부', assertFails(getDoc(doc(bob, 'users/alice/gear/g1'))));
  await check('남(bob): alice 공간에 쓰기 거부', assertFails(setDoc(doc(bob, 'users/alice/gear/evil'), { v: 1 })));
  await check('남(bob): alice 데이터 삭제 거부', assertFails(deleteDoc(doc(bob, 'users/alice/gear/g1'))));
  await check('남(bob): alice 설정 읽기 거부', assertFails(getDoc(doc(bob, 'users/alice/settings/app'))));
  await check('로그인 안 함: 개인 공간 읽기 거부', assertFails(getDoc(doc(anon, 'users/alice/gear/g1'))));
  await check('로그인 안 함: 개인 공간 쓰기 거부', assertFails(setDoc(doc(anon, 'users/alice/gear/x'), { v: 1 })));
  await check('로그인 안 함: 계정 문서 읽기 거부', assertFails(getDoc(doc(anon, 'users/alice'))));
  await check('users 전체 목록 읽기 거부(남의 계정 훑어보기 금지)', assertFails(getDocs(collection(alice, 'users'))));

  // 2. 전환 기간: 예전 공유 경로는 예전 APK를 위해 열려 있음
  for (const c of ['campingLogs', 'gear', 'checklists', 'cookingChecks']) {
    await check(`전환 기간: 로그인 없이 ${c} 읽기·쓰기(예전 APK)`, (async () => {
      await assertSucceeds(getDocs(collection(anon, c)));
      await assertSucceeds(setDoc(doc(anon, `${c}/old1`), { v: 1 }));
    })());
  }
  await check('전환 기간: 로그인한 사람이 legacy 읽기(가져오기)', assertSucceeds(getDocs(collection(alice, 'gear'))));
  await check('전환 기간: app/settings 읽기·쓰기', Promise.all([
    assertSucceeds(getDoc(doc(anon, 'app/settings'))),
    assertSucceeds(setDoc(doc(anon, 'app/settings'), { gearCategories: ['텐트'] })),
  ]));
  await check('app/다른문서 거부', assertFails(setDoc(doc(anon, 'app/other'), { v: 1 })));
  await check('legacy 하위 컬렉션 거부', assertFails(setDoc(doc(anon, 'gear/legacy1/sub/x'), { v: 1 })));

  // 3. 그 밖의 경로 전부 거부
  await check('그 밖의 경로 읽기 거부(로그인해도)', assertFails(getDoc(doc(alice, 'secret/x'))));
  await check('그 밖의 경로 쓰기 거부', assertFails(setDoc(doc(alice, 'groups/g1'), { v: 1 })));
  await check('그 밖의 경로: 로그인 안 함 거부', assertFails(getDoc(doc(anon, 'secret/x'))));

  // 4. 전환 기간을 닫은 뒤(주석 안내대로 1단계: 로그인한 사람만 읽기 전용)에도 의도대로 동작하는지
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const stage1 = rules.replace(/allow read, write: if true;/g, 'allow read: if request.auth != null; allow write: if false;')
    .replace("allow read, write: if id == 'settings';", "allow read: if request.auth != null && id == 'settings'; allow write: if false;");
  const stage2 = rules.replace(/\/\/ ── 전환 기간 시작 ──[\s\S]*?\/\/ ── 전환 기간 끝 ──/, '');
  await check('닫기 안내가 가리키는 "전환 기간" 블록이 규칙 파일에 있음', Promise.resolve().then(() => { if (stage1 === rules || stage2 === rules) throw new Error('전환 기간 표시를 찾지 못함'); }));
  await env.cleanup();

  const env1 = await initializeTestEnvironment({ projectId: 'demo-campbase-stage1', firestore: { host, port: Number(port), rules: stage1 } });
  await env1.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), 'gear/legacy1'), { name: '예전' }); });
  const a1 = env1.authenticatedContext('alice').firestore(), n1 = env1.unauthenticatedContext().firestore();
  await check('1단계(읽기 전용): 로그인한 사람은 legacy 읽기 가능', assertSucceeds(getDocs(collection(a1, 'gear'))));
  await check('1단계(읽기 전용): legacy 쓰기 거부', assertFails(setDoc(doc(a1, 'gear/x'), { v: 1 })));
  await check('1단계(읽기 전용): 로그인 안 하면 legacy 읽기 거부', assertFails(getDocs(collection(n1, 'gear'))));
  await check('1단계: 개인 공간은 그대로 동작', assertSucceeds(setDoc(doc(a1, 'users/alice/gear/g2'), { v: 1 })));
  await env1.cleanup();

  const env2 = await initializeTestEnvironment({ projectId: 'demo-campbase-stage2', firestore: { host, port: Number(port), rules: stage2 } });
  const a2 = env2.authenticatedContext('alice').firestore();
  await check('2단계(삭제): legacy 읽기 거부', assertFails(getDocs(collection(a2, 'gear'))));
  await check('2단계(삭제): 개인 공간은 그대로 동작', assertSucceeds(setDoc(doc(a2, 'users/alice/gear/g2'), { v: 1 })));
  await env2.cleanup();

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
