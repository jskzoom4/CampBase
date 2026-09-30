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

  /* ---------------- rules ---------------- */
  const LEGACY = ['campingLogs', 'gear', 'checklists', 'cookingChecks'];
  function allowed(path) {
    if (window.__fakeDenied) return false;
    const seg = path.split('/');
    if (seg[0] === 'users') return !!(currentUser && seg[1] === currentUser.uid);
    if (window.__fakeLegacyClosed) return false;
    if (LEGACY.includes(seg[0])) return seg.length <= 2;
    if (seg[0] === 'app') return seg.length === 2 && seg[1] === 'settings';
    return false;
  }
  const denied = () => Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
  function guard(path) {
    window.__fsAccess.push(path);
    if (!allowed(path)) throw denied();
  }

  /* ---------------- firestore ---------------- */
  function colDocs(path) {
    const depth = path.split('/').length + 1;
    return Object.keys(store).filter(p => p.startsWith(path + '/') && p.split('/').length === depth)
      .sort().map(p => ({ id: p.split('/').pop(), data: store[p] }));
  }
  function qSnap(ref, prev) {
    const docs = colDocs(ref.path);
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
    if (!allowed(l.ref.path)) { l.err && l.err(denied()); return; }
    if (l.ref.type === 'col') { const r = qSnap(l.ref, l.prev); l.prev = r.docs; l.cb(r.snap); }
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
      guard(ref.path);
      await ensureReady();
      const d = clone(data);
      store[ref.path] = d; emitAll();
      await window.__fsWrite(ref.path, d);
    },
    deleteDoc: async ref => {
      guard(ref.path);
      await ensureReady();
      delete store[ref.path]; emitAll();
      await window.__fsWrite(ref.path, null);
    },
    getDocs: async ref => { guard(ref.path); await ensureReady(); return qSnap(ref, null).snap; },
    getDoc: async ref => { guard(ref.path); await ensureReady(); return dSnap(ref); },
  };
  window.__FIREBASE_MODULES__ = { app, firestore, auth };
})();
