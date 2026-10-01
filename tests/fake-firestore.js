// Fake of the Firebase modular SDK subset the app uses (firebase-app + firebase-firestore + firebase-auth).
// Data lives in the Node test runner (exposed bindings), so several independent browser
// contexts behave like several phones sharing one Firestore project.
// Injected via addInitScript as window.__FIREBASE_MODULES__.
//
// Fake Auth: the signed-in user is kept in this context's localStorage (like the real SDK's
// persistent login), signInWithPopup signs in window.__fakePopupUser, and signInWithCredential
// signs in window.__fakeTokenUsers[idToken] (the APK path: native Google login → idToken).
// Fake rules (same intent as firestore.rules): users/{uid}/** only for that signed-in uid,
// legacy top-level paths open (unless window.__fakeLegacyClosed), everything else denied.
(() => {
  const apps = [];
  const listeners = new Set();   // {ref, cb, err, prev}
  let store = {};                // path -> data (local mirror)
  let ready = null;
  const clone = v => JSON.parse(JSON.stringify(v));

  function ensureReady() {
    if (!ready) ready = window.__fsDump().then(d => { store = d || {}; });
    return ready;
  }
  window.__fsApply = (path, data) => {       // called by the runner when any client writes
    if (data === null) delete store[path]; else store[path] = data;
    emitAll();
  };
  window.__fakeOffline = false;
  window.__fakeDenied = false;
  window.__fakeLegacyClosed = false;
  window.__fsAccess = [];                    // every path this page touched (for isolation checks)

  /* ---------------- auth ---------------- */
  const AUTH_KEY = '__fakeAuthUser';
  let currentUser = null;
  try { currentUser = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) {}
  const authListeners = new Set();
  const authObj = { name: 'fake-auth' };
  const asUser = u => (u ? { uid: u.uid, displayName: u.displayName || null, email: u.email || null, photoURL: u.photoURL || null } : null);
  function setUser(u) {
    currentUser = u ? clone(u) : null;
    try { if (u) localStorage.setItem(AUTH_KEY, JSON.stringify(u)); else localStorage.removeItem(AUTH_KEY); } catch (e) {}
    authListeners.forEach(cb => cb(asUser(currentUser)));
  }
  window.__fakeCurrentUid = () => (currentUser ? currentUser.uid : null);
  window.__fakeCredentialCalls = [];
  window.__fakePopupCalls = 0;
  window.__fakeAuthInit = null;
  class GoogleAuthProvider {
    constructor() { this.providerId = 'google.com'; this.params = {}; }
    setCustomParameters(p) { this.params = p; return this; }
    static credential(idToken, accessToken) { return { providerId: 'google.com', idToken, accessToken: accessToken || null }; }
  }
  const authErr = code => Object.assign(new Error('Firebase: Error (' + code + ').'), { code });
  const auth = {
    getAuth: () => { window.__fakeAuthInit = window.__fakeAuthInit || { kind: 'getAuth' }; return authObj; },
    initializeAuth: (a, opts) => { window.__fakeAuthInit = { kind: 'initializeAuth', persistence: (opts && opts.persistence || []).map(p => p.type) }; return authObj; },
    indexedDBLocalPersistence: { type: 'indexedDB' },
    browserLocalPersistence: { type: 'local' },
    GoogleAuthProvider,
    onAuthStateChanged: (a, cb) => {
      authListeners.add(cb);
      setTimeout(() => cb(asUser(currentUser)), 20);   // like the real SDK: first call after the saved login is read
      return () => authListeners.delete(cb);
    },
    signInWithPopup: async (a, provider) => {
      window.__fakePopupCalls++;
      window.__fakeLastProvider = provider;
      await new Promise(r => setTimeout(r, 30));
      const u = window.__fakePopupUser;
      if (!u) throw authErr('auth/popup-closed-by-user');
      setUser(u);
      return { user: asUser(u) };
    },
    signInWithRedirect: async () => { throw authErr('auth/operation-not-supported-in-this-environment'); },
    signInWithCredential: async (a, cred) => {
      window.__fakeCredentialCalls.push(clone(cred));
      const u = (window.__fakeTokenUsers || {})[cred && cred.idToken];
      if (!u) throw authErr('auth/invalid-credential');
      setUser(u);
      return { user: asUser(u) };
    },
    signOut: async () => { setUser(null); },
  };

  /* ---------------- rules (firestore.rules와 같은 뜻) ---------------- */
  const LEGACY = ['campingLogs', 'gear', 'checklists', 'cookingChecks'];
  const me = () => (currentUser ? currentUser.uid : null);
  const INVITE_RE = /^[A-HJ-NP-Z2-9]{6,8}$/;
  const GROUP_SUBS = ['checklists', 'gear', 'trips', 'checklistTemplates'];   // firestore.rules의 허용 목록
  const groupSubOk = seg => seg.length <= 4 && GROUP_SUBS.includes(seg[2]);
  function isMemberOf(gid) { const g = store['groups/' + gid]; return !!(me() && g && (g.memberUids || []).includes(me())); }
  function canRead(ref) {
    if (window.__fakeDenied) return false;
    const seg = ref.path.split('/');
    const f = (ref.filters || [])[0];
    if (seg[0] === 'users') return !!(me() && seg[1] === me());
    if (seg[0] === 'groups') {
      if (seg.length === 1) return !!(f && f.field === 'memberUids' && f.op === 'array-contains' && f.value === me());
      return groupSubOk(seg) && isMemberOf(seg[1]);
    }
    if (seg[0] === 'groupInvites') {
      if (seg.length === 2) return !!me();
      return !!(f && f.field === 'gid' && f.op === '==' && isMemberOf(f.value));
    }
    // 전환 기간 1단계: 로그인한 사람만 읽기
    if (window.__fakeLegacyClosed || !me()) return false;
    if (LEGACY.includes(seg[0])) return seg.length <= 2;
    if (seg[0] === 'app') return seg.length === 2 && seg[1] === 'settings';
    return false;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const setOf = a => new Set(a || []);
  const minus = (a, b) => [...setOf(a)].filter(x => !setOf(b).has(x));
  function canWrite(path, before, after) {
    if (window.__fakeDenied || !me()) return false;
    const seg = path.split('/');
    if (seg[0] === 'users') return seg[1] === me();
    if (seg[0] === 'groups' && seg.length === 2) {
      const gid = seg[1];
      if (!before) {   // 만들기
        return !!after && after.ownerUid === me() && same(after.memberUids, [me()]) && same(Object.keys(after.members || {}), [me()])
          && after.members[me()].role === 'owner' && typeof after.name === 'string' && after.name.length > 0 && after.name.length <= 40;
      }
      const isMember = (before.memberUids || []).includes(me()), isOwner = before.ownerUid === me();
      if (!after) return isOwner;   // 삭제
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      const changed = [...keys].filter(k => !same(before[k], after[k]));
      const only = allowed => changed.every(k => allowed.includes(k));
      const added = minus(after.memberUids, before.memberUids), removed = minus(before.memberUids, after.memberUids);
      const mAdded = minus(Object.keys(after.members || {}), Object.keys(before.members || {}));
      const mRemoved = minus(Object.keys(before.members || {}), Object.keys(after.members || {}));
      const membersOk = (a, r) => same(added.sort(), a.slice().sort()) && same(removed.sort(), r.slice().sort()) && same(mAdded.sort(), a.slice().sort()) && same(mRemoved.sort(), r.slice().sort())
        && Object.keys(before.members || {}).filter(k => !r.includes(k)).every(k => same(before.members[k], after.members[k]));
      if (isOwner && only(['name']) && typeof after.name === 'string' && after.name.length > 0) return true;
      if (isMember && only(['gearCategories'])) return true;
      if (!isMember && only(['memberUids', 'members', 'joinCode']) && membersOk([me()], [])) {       // 참여
        const inv = store['groupInvites/' + after.joinCode];
        return !!(inv && inv.gid === gid && inv.expiresAt > Date.now() && after.members[me()].role === 'member');
      }
      if (isMember && !isOwner && only(['memberUids', 'members']) && membersOk([], [me()])) return true;   // 나가기
      if (isOwner && only(['memberUids', 'members']) && removed.length > 0 && !removed.includes(me()) && membersOk([], removed)) return true;   // 내보내기
      return false;
    }
    if (seg[0] === 'groups') return groupSubOk(seg) && isMemberOf(seg[1]);
    if (seg[0] === 'groupInvites') {
      if (!before) return !!after && INVITE_RE.test(seg[1]) && after.createdBy === me() && isMemberOf(after.gid);
      if (!after) return before.createdBy === me() || (store['groups/' + before.gid] || {}).ownerUid === me();
      return false;
    }
    return false;   // 예전 공유 경로(legacy)는 읽기 전용
  }
  const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  function guardRead(ref) { window.__fsAccess.push(ref.path); if (!canRead(ref)) throw denied(); }
  function guardWrite(path, before, after) { window.__fsAccess.push(path); if (!canWrite(path, before, after)) throw denied(); }
  // update()의 특수 값(arrayUnion 등)과 'a.b' 경로 적용
  function applyUpdate(before, data) {
    const out = clone(before);
    Object.entries(data).forEach(([k, v]) => {
      const parts = k.split('.');
      let o = out;
      parts.slice(0, -1).forEach(p => { if (!o[p] || typeof o[p] !== 'object') o[p] = {}; o = o[p]; });
      const last = parts[parts.length - 1];
      if (v && v.__op === 'delete') delete o[last];
      else if (v && v.__op === 'arrayUnion') { const arr = Array.isArray(o[last]) ? o[last] : []; v.values.forEach(x => { if (!arr.some(y => same(x, y))) arr.push(x); }); o[last] = arr; }
      else if (v && v.__op === 'arrayRemove') { o[last] = (Array.isArray(o[last]) ? o[last] : []).filter(y => !v.values.some(x => same(x, y))); }
      else o[last] = clone(v);
    });
    return out;
  }

  /* ---------------- firestore ---------------- */
  function matches(d, f) {
    const v = d[f.field];
    if (f.op === 'array-contains') return Array.isArray(v) && v.some(x => same(x, f.value));
    if (f.op === '==') return same(v, f.value);
    throw new Error('fake: unsupported op ' + f.op);
  }
  function colDocs(path, filters) {
    const depth = path.split('/').length + 1;
    return Object.keys(store).filter(p => p.startsWith(path + '/') && p.split('/').length === depth)
      .filter(p => (filters || []).every(f => matches(store[p], f)))
      .sort().map(p => ({ id: p.split('/').pop(), data: store[p] }));
  }
  function qSnap(ref, prev) {
    const all = colDocs(ref.path, ref.filters);
    const docs = ref.limit ? all.slice(0, ref.limit) : all;
    const prevMap = new Map((prev || []).map(d => [d.id, JSON.stringify(d.data)]));
    const changes = [];
    docs.forEach(d => { const j = JSON.stringify(d.data); if (prevMap.get(d.id) !== j) changes.push({ type: prevMap.has(d.id) ? 'modified' : 'added', doc: d }); prevMap.delete(d.id); });
    prevMap.forEach((_, id) => changes.push({ type: 'removed', doc: { id } }));
    return {
      snap: {
        empty: docs.length === 0,
        docs: docs.map(d => ({ id: d.id, data: () => clone(d.data) })),
        docChanges: () => changes,
        metadata: { fromCache: !!window.__fakeOffline, hasPendingWrites: false },
      }, docs
    };
  }
  function dSnap(ref) {
    const has = Object.prototype.hasOwnProperty.call(store, ref.path);
    return { exists: () => has, data: () => (has ? clone(store[ref.path]) : undefined), metadata: { fromCache: !!window.__fakeOffline } };
  }
  function emit(l) {
    if (!canRead(l.ref)) { if (!l.deniedOnce) { l.deniedOnce = true; l.err && l.err(denied()); } return; }
    l.deniedOnce = false;
    if (l.ref.type === 'col' || l.ref.type === 'query') { const r = qSnap(l.ref, l.prev); l.prev = r.docs; l.cb(r.snap); }
    else l.cb(dSnap(l.ref));
  }
  function emitAll() { listeners.forEach(emit); }
  window.__fakeEmitAll = emitAll;
  window.__fakeListenerCount = () => listeners.size;

  function checkData(data, ignoreUndef) {
    const walk = (v, p) => {
      if (v === undefined && !ignoreUndef) throw new Error('Unsupported field value: undefined (' + p + ')');
      if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, p + '.' + k));
    };
    walk(data, 'doc');
  }
  let settingsIgnoreUndef = false;
  const segs = p => p.split('/').filter(Boolean).length;

  const app = {
    getApps: () => apps.slice(),
    initializeApp: cfg => { const a = { options: cfg }; apps.push(a); return a; },
  };
  const firestore = {
    initializeFirestore: (a, s) => { settingsIgnoreUndef = !!(s && s.ignoreUndefinedProperties); window.__fsSettings = s; return { app: a }; },
    getFirestore: a => ({ app: a }),
    persistentLocalCache: o => ({ kind: 'persistent', ...(o || {}) }),
    persistentMultipleTabManager: () => ({ kind: 'multiTab' }),
    collection: (db, path) => {
      if (segs(path) % 2 !== 1) throw new Error('Invalid collection reference: ' + path);
      return { type: 'col', path };
    },
    query: (ref, ...constraints) => ({ type: 'query', path: ref.path, filters: constraints.filter(c => !('limit' in c)), limit: (constraints.find(c => 'limit' in c) || {}).limit }),
    limit: n => ({ limit: n }),
    where: (field, op, value) => ({ field, op, value }),
    arrayUnion: (...values) => ({ __op: 'arrayUnion', values }),
    arrayRemove: (...values) => ({ __op: 'arrayRemove', values }),
    deleteField: () => ({ __op: 'delete' }),
    doc: (db, a, b) => {
      const path = b ? a + '/' + b : a;
      if (segs(path) % 2 !== 0) throw new Error('Invalid document reference: ' + path);
      return { type: 'doc', path };
    },
    onSnapshot: (ref, opts, next, err) => {
      if (typeof opts === 'function') { err = next; next = opts; }
      const l = { ref, cb: next, err, prev: null };
      listeners.add(l);
      window.__fsAccess.push(ref.path);
      ensureReady().then(() => {
        if (!listeners.has(l)) return;
        // like the real SDK: first a cache snapshot, then the server one
        const wasOffline = window.__fakeOffline;
        window.__fakeOffline = true; emit(l); window.__fakeOffline = wasOffline;
        setTimeout(() => { if (listeners.has(l)) emit(l); }, 40);
      });
      return () => listeners.delete(l);
    },
    setDoc: async (ref, data) => {
      checkData(data, settingsIgnoreUndef);
      await ensureReady();
      guardWrite(ref.path, store[ref.path] || null, data);
      const d = clone(data);
      store[ref.path] = d; emitAll();
      await window.__fsWrite(ref.path, d);
    },
    updateDoc: async (ref, data) => {
      await ensureReady();
      if (!Object.prototype.hasOwnProperty.call(store, ref.path)) {
        window.__fsAccess.push(ref.path);
        // 진짜 Firestore처럼: 읽을 권한이 없으면 permission-denied, 있으면 not-found
        throw canRead({ path: ref.path }) ? Object.assign(new Error('No document to update'), { code: 'not-found' }) : denied();
      }
      const before = store[ref.path], after = applyUpdate(before, data);
      guardWrite(ref.path, before, after);
      store[ref.path] = after; emitAll();
      await window.__fsWrite(ref.path, after);
    },
    deleteDoc: async ref => {
      await ensureReady();
      guardWrite(ref.path, store[ref.path] || null, null);
      delete store[ref.path]; emitAll();
      await window.__fsWrite(ref.path, null);
    },
    getDocs: async ref => { await ensureReady(); guardRead(ref); return qSnap(ref, null).snap; },
    getDoc: async ref => { await ensureReady(); guardRead(ref); return dSnap(ref); },
  };
  window.__FIREBASE_MODULES__ = { app, firestore, auth };
})();
