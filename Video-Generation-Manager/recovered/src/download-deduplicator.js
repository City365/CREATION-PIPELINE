"use strict";

function e(e = {}) {
  const t = Math.max(0, Number(e.reuseMs) || 0),
    r = new Map();
  function o(e, t) {
    r.get(e) === t && r.delete(e);
  }
  return {
    run: function (e, n) {
      const i = String(e || "");
      if (!i) return Promise.resolve().then(n);
      const s = r.get(i);
      if (s) return s.promise;
      const u = {
        promise: null,
        timer: null
      };
      return u.promise = Promise.resolve().then(n).then(e => e?.ok && 0 !== t ? (u.timer = setTimeout(() => o(i, u), t), u.timer.unref?.(), e) : (o(i, u), e), e => {
        throw o(i, u), e;
      }), r.set(i, u), u.promise;
    },
    clear: function () {
      for (const e of r.values()) clearTimeout(e.timer);
      r.clear();
    },
    size: () => r.size
  };
}
module.exports = {
  createDownloadDeduplicator: e
};
