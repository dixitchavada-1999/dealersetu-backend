/**
 * Strip MongoDB operator-injection payloads from the request body.
 *
 * Removes any object key starting with '$' (e.g. $ne, $gt, $where) or
 * containing '.' (dotted-path injection). This blocks NoSQL operator
 * injection like { "userName": { "$gt": "" } } used to bypass auth.
 *
 * Express 5 note: req.query / req.params are read-only getters, so we only
 * sanitize the mutable req.body. Controllers additionally string-coerce
 * security-sensitive credentials as defense-in-depth.
 */
function scrub(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return;
  if (Array.isArray(value)) {
    value.forEach((v) => scrub(v, depth + 1));
    return;
  }
  for (const key of Object.keys(value)) {
    // Block Mongo operators ($, dotted paths) and prototype-pollution keys.
    if (key.startsWith('$') || key.includes('.') || key === '__proto__' || key === 'constructor' || key === 'prototype') {
      delete value[key];
    } else {
      scrub(value[key], depth + 1);
    }
  }
}

module.exports = function sanitizeMongo(req, _res, next) {
  if (req.body) scrub(req.body);
  next();
};
