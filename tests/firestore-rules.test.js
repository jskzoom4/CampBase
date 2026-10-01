// firestore.rules 테스트 — 진짜 Firestore 에뮬레이터 + @firebase/rules-unit-testing.
// 실행(저장소 루트에서, Java 11 이상 필요):
//   npm i --no-save firebase-tools@13 @firebase/rules-unit-testing@3
//   npx firebase emulators:exec --only firestore,auth --project demo-campbase "node tests/firestore-rules.test.js"
const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, updateDoc, collection, getDocs, query, where, limit, arrayUnion, arrayRemove, deleteField, setLogLevel } = require('firebase/firestore');
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

  // 2. 전환 기간(1단계 적용 중): 예전 공유 경로는 로그인한 사람만 읽기 전용
  for (const c of ['campingLogs', 'gear', 'checklists', 'cookingChecks']) {
    await check(`전환 기간: 로그인한 사람은 ${c} 읽기(가져오기)`, assertSucceeds(getDocs(collection(alice, c))));
    await check(`전환 기간: 로그인해도 ${c} 쓰기·삭제 거부`, (async () => {
      await assertFails(setDoc(doc(alice, `${c}/old1`), { v: 1 }));
      await assertFails(deleteDoc(doc(alice, `${c}/legacy1`)));
    })());
    await check(`전환 기간: 로그인 안 하면(예전 APK) ${c} 읽기·쓰기 거부`, (async () => {
      await assertFails(getDocs(collection(anon, c)));
      await assertFails(setDoc(doc(anon, `${c}/old1`), { v: 1 }));
    })());
  }
  await check('전환 기간: 로그인한 사람은 app/settings 읽기', assertSucceeds(getDoc(doc(alice, 'app/settings'))));
  await check('전환 기간: app/settings 쓰기 거부', assertFails(setDoc(doc(alice, 'app/settings'), { gearCategories: ['텐트'] })));
  await check('전환 기간: 로그인 안 하면 app/settings 읽기 거부', assertFails(getDoc(doc(anon, 'app/settings'))));
  await check('app/다른문서 읽기 거부', assertFails(getDoc(doc(alice, 'app/other'))));
  await check('legacy 하위 컬렉션 거부', assertFails(setDoc(doc(alice, 'gear/legacy1/sub/x'), { v: 1 })));

  // 3. 그 밖의 경로 전부 거부
  await check('그 밖의 경로 읽기 거부(로그인해도)', assertFails(getDoc(doc(alice, 'secret/x'))));
  await check('그 밖의 경로 쓰기 거부', assertFails(setDoc(doc(alice, 'somethingElse/g1'), { v: 1 })));
  await check('그 밖의 경로: 로그인 안 함 거부', assertFails(getDoc(doc(anon, 'secret/x'))));

  // 3-1. 그룹
  const carol = env.authenticatedContext('carol').firestore();
  const DAY = 24 * 60 * 60 * 1000;
  const member = (name, role) => ({ name, photoURL: '', role });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    // alice(그룹장) + bob(멤버). carol은 비멤버.
    await setDoc(doc(db, 'groups/fam'), { name: '캠핑팸', ownerUid: 'alice', memberUids: ['alice', 'bob'],
      members: { alice: member('앨리스', 'owner'), bob: member('밥', 'member') }, createdAt: 'x', gearCategories: ['텐트', '기타'] });
    await setDoc(doc(db, 'groups/fam/checklists/l1'), { title: '그룹 리스트', items: [] });
    await setDoc(doc(db, 'groups/other'), { name: '다른 그룹', ownerUid: 'dave', memberUids: ['dave'], members: { dave: member('데이브', 'owner') }, createdAt: 'x' });
    await setDoc(doc(db, 'groupInvites/GOODCD'), { gid: 'fam', groupName: '캠핑팸', createdBy: 'alice', expiresAt: Date.now() + 7 * DAY, createdAt: 'x' });
    await setDoc(doc(db, 'groupInvites/OLDCDE'), { gid: 'fam', groupName: '캠핑팸', createdBy: 'alice', expiresAt: Date.now() - 1000, createdAt: 'x' });
    await setDoc(doc(db, 'groupInvites/OTHERG'), { gid: 'other', groupName: '다른 그룹', createdBy: 'dave', expiresAt: Date.now() + DAY, createdAt: 'x' });
  });
  const joinAs = (who, uid, code, extra = {}) => updateDoc(doc(who, 'groups/fam'), { memberUids: arrayUnion(uid), ['members.' + uid]: member(uid, 'member'), joinCode: code, ...extra });

  // 읽기
  await check('그룹: 멤버는 그룹 문서 읽기', assertSucceeds(getDoc(doc(bob, 'groups/fam'))));
  await check('그룹: 비멤버는 그룹 문서 읽기 거부', assertFails(getDoc(doc(carol, 'groups/fam'))));
  await check('그룹: 로그인 안 하면 읽기 거부', assertFails(getDoc(doc(anon, 'groups/fam'))));
  await check('그룹: 내 그룹 목록 쿼리(array-contains 나)', (async () => {
    const s = await assertSucceeds(getDocs(query(collection(bob, 'groups'), where('memberUids', 'array-contains', 'bob'))));
    if (s.size !== 1) throw new Error('size ' + s.size);
  })());
  await check('그룹: 조건 없이 그룹 전체 목록 읽기 거부', assertFails(getDocs(collection(bob, 'groups'))));
  await check('그룹 데이터: 멤버 읽기·쓰기', (async () => {
    await assertSucceeds(getDocs(collection(bob, 'groups/fam/checklists')));
    await assertSucceeds(setDoc(doc(bob, 'groups/fam/gear/g1'), { name: '텐트', addedBy: 'bob' }));
  })());
  await check('그룹 데이터: 비멤버 읽기 거부', assertFails(getDocs(collection(carol, 'groups/fam/checklists'))));
  await check('그룹 데이터: 비멤버 쓰기 거부', assertFails(setDoc(doc(carol, 'groups/fam/gear/x'), { v: 1 })));

  // 만들기
  await check('그룹 만들기: 내가 그룹장이자 유일한 멤버면 허용', assertSucceeds(setDoc(doc(carol, 'groups/carolG'), {
    name: '캐롤팀', ownerUid: 'carol', memberUids: ['carol'], members: { carol: member('캐롤', 'owner') }, createdAt: 'x', gearCategories: ['기타'] })));
  await check('그룹 만들기: 다른 사람을 멤버로 넣으면 거부', assertFails(setDoc(doc(carol, 'groups/carolG2'), {
    name: '캐롤팀', ownerUid: 'carol', memberUids: ['carol', 'bob'], members: { carol: member('캐롤', 'owner'), bob: member('밥', 'member') }, createdAt: 'x' })));
  await check('그룹 만들기: 남을 그룹장으로 넣으면 거부', assertFails(setDoc(doc(carol, 'groups/carolG3'), {
    name: '캐롤팀', ownerUid: 'bob', memberUids: ['bob'], members: { bob: member('밥', 'owner') }, createdAt: 'x' })));

  // 참여
  await check('참여: 코드 없이 참여 거부', assertFails(updateDoc(doc(carol, 'groups/fam'), { memberUids: arrayUnion('carol'), 'members.carol': member('캐롤', 'member') })));
  await check('참여: 없는 코드로 참여 거부', assertFails(joinAs(carol, 'carol', 'NOPE22')));
  await check('참여: 만료된 코드로 참여 거부', assertFails(joinAs(carol, 'carol', 'OLDCDE')));
  await check('참여: 다른 그룹 코드로 참여 거부', assertFails(joinAs(carol, 'carol', 'OTHERG')));
  await check('참여: 남(erin)을 멤버로 추가 거부', assertFails(joinAs(carol, 'erin', 'GOODCD')));
  await check('참여: 자기를 그룹장 역할로 넣기 거부', assertFails(updateDoc(doc(carol, 'groups/fam'), { memberUids: arrayUnion('carol'), 'members.carol': member('캐롤', 'owner'), joinCode: 'GOODCD' })));
  await check('참여: 참여하면서 이름까지 바꾸기 거부', assertFails(joinAs(carol, 'carol', 'GOODCD', { name: '해킹' })));
  await check('참여: 유효한 코드로 자기 자신만 추가하면 허용', assertSucceeds(joinAs(carol, 'carol', 'GOODCD')));
  await check('참여 후: 그룹 데이터 읽기 가능', assertSucceeds(getDocs(collection(carol, 'groups/fam/checklists'))));

  // 멤버 권한 / 그룹장 권한
  await check('멤버: 장비 카테고리 변경 허용', assertSucceeds(updateDoc(doc(bob, 'groups/fam'), { gearCategories: ['텐트', '해먹', '기타'] })));
  await check('멤버: 그룹 이름 변경 거부', assertFails(updateDoc(doc(bob, 'groups/fam'), { name: '밥의 그룹' })));
  await check('멤버: 다른 멤버 내보내기 거부', assertFails(updateDoc(doc(bob, 'groups/fam'), { memberUids: arrayRemove('carol'), 'members.carol': deleteField() })));
  await check('멤버: 그룹장 바꾸기 거부', assertFails(updateDoc(doc(bob, 'groups/fam'), { ownerUid: 'bob' })));
  await check('멤버: 그룹 삭제 거부', assertFails(deleteDoc(doc(bob, 'groups/fam'))));
  await check('그룹장: 이름 변경 허용', assertSucceeds(updateDoc(doc(alice, 'groups/fam'), { name: '캠핑팸2' })));
  await check('그룹장: 자기 자신 내보내기 거부', assertFails(updateDoc(doc(alice, 'groups/fam'), { memberUids: arrayRemove('alice'), 'members.alice': deleteField() })));
  await check('그룹장: 나가기 거부(그룹을 삭제해야 함)', assertFails(updateDoc(doc(alice, 'groups/fam'), { memberUids: arrayRemove('alice'), 'members.alice': deleteField() })));
  await check('그룹장: 멤버 내보내기 허용', assertSucceeds(updateDoc(doc(alice, 'groups/fam'), { memberUids: arrayRemove('carol'), 'members.carol': deleteField() })));
  await check('내보낸 뒤: 그 사람은 그룹 데이터 읽기 거부', assertFails(getDocs(collection(carol, 'groups/fam/checklists'))));
  await check('나가기: 멤버가 자기 자신만 빼면 허용', assertSucceeds(updateDoc(doc(bob, 'groups/fam'), { memberUids: arrayRemove('bob'), 'members.bob': deleteField() })));

  // 초대 코드
  await check('초대 코드: 로그인한 사람은 코드 한 개 읽기', assertSucceeds(getDoc(doc(carol, 'groupInvites/GOODCD'))));
  await check('초대 코드: 로그인 안 하면 읽기 거부', assertFails(getDoc(doc(anon, 'groupInvites/GOODCD'))));
  await check('초대 코드: 비멤버가 코드 목록 훑어보기 거부', assertFails(getDocs(query(collection(carol, 'groupInvites'), where('gid', '==', 'fam')))));
  await check('초대 코드: 멤버는 자기 그룹 코드 목록 읽기', assertSucceeds(getDocs(query(collection(alice, 'groupInvites'), where('gid', '==', 'fam')))));
  const inv = (by, gid, extra = {}) => ({ gid, groupName: 'x', createdBy: by, expiresAt: Date.now() + 7 * DAY, createdAt: 'x', ...extra });
  await check('초대 코드: 멤버가 만들기 허용', assertSucceeds(setDoc(doc(alice, 'groupInvites/ABC234'), inv('alice', 'fam'))));
  await check('초대 코드: 비멤버가 만들기 거부', assertFails(setDoc(doc(carol, 'groupInvites/ABC235'), inv('carol', 'fam'))));
  await check('초대 코드: 헷갈리는 글자(0/O/1/I) 코드 거부', assertFails(setDoc(doc(alice, 'groupInvites/ABC0O1'), inv('alice', 'fam'))));
  await check('초대 코드: 만료가 너무 먼 코드 거부', assertFails(setDoc(doc(alice, 'groupInvites/ABC236'), inv('alice', 'fam', { expiresAt: Date.now() + 30 * DAY }))));
  await check('초대 코드: 이미 있는 코드 덮어쓰기 거부', assertFails(setDoc(doc(alice, 'groupInvites/GOODCD'), inv('alice', 'fam'))));
  await check('초대 코드: 만든 사람 삭제 허용', assertSucceeds(deleteDoc(doc(alice, 'groupInvites/ABC234'))));
  await check('초대 코드: 다른 사람(그룹장 아님) 삭제 거부', assertFails(deleteDoc(doc(carol, 'groupInvites/OTHERG'))));

  // 그룹 삭제(그룹장): 하위 데이터 → 초대 코드 → 그룹 문서 순서
  await check('그룹장: 하위 데이터·초대 코드·그룹 삭제', (async () => {
    await assertSucceeds(deleteDoc(doc(alice, 'groups/fam/checklists/l1')));
    await assertSucceeds(deleteDoc(doc(alice, 'groups/fam/gear/g1')));
    await assertSucceeds(deleteDoc(doc(alice, 'groupInvites/GOODCD')));
    await assertSucceeds(deleteDoc(doc(alice, 'groups/fam')));
  })());

  // 4. 전환 기간 2단계(블록 삭제) 후에도 의도대로 동작하는지
  const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
  const stage2 = rules.replace(/\/\/ ── 전환 기간 시작 ──[\s\S]*?\/\/ ── 전환 기간 끝 ──/, '');
  await check('닫기 안내가 가리키는 "전환 기간" 블록이 규칙 파일에 있음', Promise.resolve().then(() => { if (stage2 === rules) throw new Error('전환 기간 표시를 찾지 못함'); }));
  await env.cleanup();

  const env2 = await initializeTestEnvironment({ projectId: 'demo-campbase-stage2', firestore: { host, port: Number(port), rules: stage2 } });
  const a2 = env2.authenticatedContext('alice').firestore();
  await check('2단계(삭제): legacy 읽기 거부', assertFails(getDocs(collection(a2, 'gear'))));
  await check('2단계(삭제): 개인 공간은 그대로 동작', assertSucceeds(setDoc(doc(a2, 'users/alice/gear/g2'), { v: 1 })));
  await env2.cleanup();

  // 5. firestore.rules.final(2단계 게시용 초안): 지금 규칙에서 전환 기간 블록만 뺀 것과 내용이 같아야 함
  const finalRules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules.final'), 'utf8');
  const norm = t => t.split('\n').map(l => l.replace(/\/\/.*$/, '').trim()).filter(Boolean).join('\n');
  await check('firestore.rules.final = firestore.rules에서 전환 기간 블록만 뺀 것(주석 제외)', Promise.resolve().then(() => {
    if (norm(finalRules) !== norm(stage2)) throw new Error('firestore.rules.final이 firestore.rules와 어긋났어요. 규칙을 바꿨다면 .final도 같이 바꿔주세요.');
  }));
  const env3 = await initializeTestEnvironment({ projectId: 'demo-campbase-final', firestore: { host, port: Number(port), rules: finalRules } });
  await env3.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'gear/legacy1'), { name: '예전 공유 장비' });
    await setDoc(doc(db, 'app/settings'), { gearCategories: ['텐트'] });
    await setDoc(doc(db, 'groups/fam'), { name: '캠핑팸', ownerUid: 'alice', memberUids: ['alice'], members: { alice: member('앨리스', 'owner') }, createdAt: 'x' });
  });
  const a3 = env3.authenticatedContext('alice').firestore();
  const b3 = env3.authenticatedContext('bob').firestore();
  for (const c of ['campingLogs', 'gear', 'checklists', 'cookingChecks']) {
    await check(`final 규칙: legacy ${c} 읽기·쓰기 거부(로그인해도)`, (async () => {
      await assertFails(getDocs(query(collection(a3, c), limit(1))));
      await assertFails(setDoc(doc(a3, `${c}/x`), { v: 1 }));
    })());
  }
  await check('final 규칙: app/settings 읽기 거부', assertFails(getDoc(doc(a3, 'app/settings'))));
  await check('final 규칙: 개인 공간 읽기·쓰기는 그대로', (async () => {
    await assertSucceeds(setDoc(doc(a3, 'users/alice/gear/g3'), { v: 1 }));
    await assertSucceeds(getDocs(collection(a3, 'users/alice/gear')));
    await assertFails(getDocs(collection(b3, 'users/alice/gear')));
  })());
  await check('final 규칙: 그룹 규칙은 그대로(멤버 읽기 허용·비멤버 거부)', (async () => {
    await assertSucceeds(getDoc(doc(a3, 'groups/fam')));
    await assertSucceeds(setDoc(doc(a3, 'groups/fam/gear/g1'), { name: '텐트' }));
    await assertFails(getDoc(doc(b3, 'groups/fam')));
    await assertFails(getDocs(collection(b3, 'groups/fam/gear')));
  })());
  await env3.cleanup();

  const failed = results.filter(r => !r).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
