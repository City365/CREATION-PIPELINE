"use strict";

const e = 2,
  t = Object.freeze([500, 1500]),
  r = new Set([-7, -100, -101, -111, -118, -130]);
function n(e) {
  return r.has(Number(e));
}
function o(e, r) {
  if (!n(r)) return null;
  const o = (Number.isInteger(e) && e > 0 ? e : 0) + 1;
  return o > 2 ? null : {
    attempt: o,
    delayMs: t[o - 1]
  };
}
module.exports = {
  DOLA_NETWORK_RECOVERY_MAX_ATTEMPTS: 2,
  isRecoverableDolaNetworkError: n,
  nextDolaNetworkRecoveryAttempt: o
};
