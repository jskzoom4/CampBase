// Fake of the Firebase modular SDK subset the app uses (firebase-app + firebase-firestore).
// Data lives in the Node test runner (exposed bindings), so several independent browser
// contexts behave like several phones sharing one Firestore project.
// Injected via addInitScript as window.__FIREBASE_MODULES__.
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

  function colDocs(name) {
    return Object.keys(store).filter(p => p.startsWith(name + '/') && p.split('/').length === 2)
      .sort().map(p => ({ id: p.split('/')[1], data: store[p] }));
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
    if (window.__fakeDenied) { l.err && l.err({ code: 'permission-denied', message: 'denied' }); return; }
    if (l.ref.type === 'col') { const r = qSnap(l.ref, l.prev); l.prev = r.docs; l.cb(r.snap); }
    else l.cb(dSnap(l.ref));
  }
  function emitAll() { listeners.forEach(emit); }
  window.__fakeEmitAll = emitAll;

  function checkData(data, ignoreUndef) {
    const walk = (v, p) => {
      if (v === undefined && !ignoreUndef) throw new Error('Unsupported field value: undefined (' + p + ')');
      if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, p + '.' + k));
    };
    walk(data, 'doc');
  }
  let settingsIgnoreUndef = false;

  const app = {
    getApps: () => apps.slice(),
    initializeApp: cfg => { const a = { options: cfg }; apps.push(a); return a; },
  };
  const firestore = {
    initializeFirestore: (a, s) => { settingsIgnoreUndef = !!(s && s.ignoreUndefinedProperties); window.__fsSettings = s; return { app: a }; },
    getFirestore: a => ({ app: a }),
    persistentLocalCache: o => ({ kind: 'persistent', ...(o || {}) }),
    persistentMultipleTabManager: () => ({ kind: 'multiTab' }),
    collection: (db, name) => ({ type: 'col', path: name }),
    doc: (db, a, b) => ({ type: 'doc', path: b ? a + '/' + b : a }),
    onSnapshot: (ref, opts, next, err) => {
      if (typeof opts === 'function') { err = next; next = opts; }
      const l = { ref, cb: next, err, prev: null };
      listeners.add(l);
      ensureReady().then(() => {
        // like the real SDK: first a cache snapshot, then the server one
        const wasOffline = window.__fakeOffline;
        window.__fakeOffline = true; emit(l); window.__fakeOffline = wasOffline;
        setTimeout(() => emit(l), 40);
      });
      return () => listeners.delete(l);
    },
    setDoc: async (ref, data) => {
      checkData(data, settingsIgnoreUndef);
      await ensureReady();
      const d = clone(data);
      store[ref.path] = d; emitAll();
      await window.__fsWrite(ref.path, d);
    },
    deleteDoc: async ref => {
      await ensureReady();
      delete store[ref.path]; emitAll();
      await window.__fsWrite(ref.path, null);
    },
    getDocs: async ref => { await ensureReady(); return qSnap(ref, null).snap; },
    getDoc: async ref => { await ensureReady(); return dSnap(ref); },
  };
  window.__FIREBASE_MODULES__ = { app, firestore };
})();
