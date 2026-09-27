/* Small localStorage wrapper. Every access is guarded: private mode or a
 * full quota must never break the game. */
const Store = (function () {
  'use strict';
  const P = 'tappaint:';

  function get(key, fallback) {
    try {
      const v = localStorage.getItem(P + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  }
  function set(key, value) {
    try {
      localStorage.setItem(P + key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }
  function remove(key) {
    try { localStorage.removeItem(P + key); } catch (e) { /* ignore */ }
  }

  return {
    get, set, remove,
    progress: id => get('prog:' + id, null),
    saveProgress: (id, p) => set('prog:' + id, p),
    meta: id => get('meta:' + id, { pct: 0, done: false }),
    saveMeta: (id, m) => set('meta:' + id, m),
    thumb: id => get('thumb:' + id, null),
    saveThumb: (id, url) => set('thumb:' + id, url),
    imports: () => get('imports', []),
    saveImports: list => set('imports', list),
    hints: () => get('hints', 10),
    setHints: n => set('hints', n),
    muted: () => get('muted', false),
    setMuted: m => set('muted', m),
    reset(id) {
      remove('prog:' + id);
      remove('meta:' + id);
      remove('thumb:' + id);
    },
  };
})();
