"use strict";

class t {
  constructor() {
    this.pendingAccountIds = new Set();
  }
  show(t) {
    const n = String(t || "").trim();
    return n && this.pendingAccountIds.add(n), this.snapshot();
  }
  finish(t, n) {
    const s = String(t || "").trim();
    if (s && this.pendingAccountIds.delete(s), Array.isArray(n)) {
      this.pendingAccountIds.clear();
      for (const t of n) {
        const n = String(t || "").trim();
        n && this.pendingAccountIds.add(n);
      }
    }
    return this.snapshot();
  }
  snapshot() {
    const t = Array.from(this.pendingAccountIds);
    return {
      accountIds: t,
      count: t.length,
      topmost: t.length > 0
    };
  }
}
module.exports = {
  VerificationWindowState: t
};
