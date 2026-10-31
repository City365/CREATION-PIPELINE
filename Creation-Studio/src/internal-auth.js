'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

// Shared only by the local Node and Python services; never returned to the UI.
function token() {
  if (process.env.WMD_INTERNAL_TOKEN) return process.env.WMD_INTERNAL_TOKEN;
  const file = path.join(config.DATA, 'internal-token.json');
  fs.mkdirSync(config.DATA, { recursive: true });
  if (!fs.existsSync(file)) {
    try {
      fs.writeFileSync(file, JSON.stringify({ token: crypto.randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  const saved = JSON.parse(fs.readFileSync(file, 'utf8')).token;
  if (typeof saved !== 'string' || saved.length < 32) throw new Error('内部服务凭据无效');
  return saved;
}

function authorized(req) {
  if (!/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/.test(String(req.socket.remoteAddress || ''))) return false;
  const supplied = String(req.headers['x-wmd-internal'] || '');
  if (!supplied || supplied === '1') return false;
  const expected = Buffer.from(token());
  const actual = Buffer.from(supplied);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

module.exports = { token, authorized };
