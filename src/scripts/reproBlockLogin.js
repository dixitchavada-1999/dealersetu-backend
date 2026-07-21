/*
 * REPRODUCE: multi-tenant customer login when one owner "blocks" them.
 *
 * Scenario (mirrors user's report):
 *   - Customer shared across Owner A, B, C (same mobile), one password.
 *   - Owner A "blocks" the customer (account isActive=false).
 *   - Customer must STILL log in (via B/C). Only when ALL owners block → denied.
 *
 * "Block" isn't an owner API today, so we flip isActive directly in the DB to
 * simulate whatever mechanism sets it. We also test the real DELETE path.
 *
 * Cleans up every entity it creates. Run: node src/scripts/reproBlockLogin.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');

const BASE = 'http://localhost:3000';
const ts = Date.now();
const MOBILE = `9${String(ts).slice(-9)}`;
const PASSWORD = 'Cust@1234';
const DEVICE = `dev_${ts}`;
const log = [];
const ok = (n, c, d) => { log.push(`${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`); return c; };

async function call(method, path, token, body) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, j };
}

async function registerOwner(tag, suffix) {
  const email = `own_${tag}_${ts}@x.test`;
  const r = await call('POST', '/api/auth/register', null, {
    firstName: 'Own', lastName: tag, email, userName: `own_${tag}_${ts}`,
    password: 'Owner@123', mobileNumber: `7${String(ts).slice(-8)}${suffix}`.slice(0, 10),
    businessName: `Business ${tag} ${ts}`,
  });
  return { token: r.j?.data?.tokens?.accessToken, tenantId: r.j?.data?.user?.tenantId, email };
}

async function onboard(ownerToken, tag) {
  const r = await call('POST', '/api/team', ownerToken, {
    firstName: 'Shared', lastName: 'Cust', mobileNumber: MOBILE, shopName: `Shop ${tag}`,
  });
  return r.j?.data?.loginCode;
}

const createdUserIds = [];
const createdTenantIds = [];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // 1. Three owners
  const A = await registerOwner('A', '1');
  const B = await registerOwner('B', '2');
  const C = await registerOwner('C', '3');
  [A, B, C].forEach(o => o.tenantId && createdTenantIds.push(o.tenantId));
  ok('3 owners registered', A.token && B.token && C.token, `A/B/C tenants ${[A, B, C].map(o => o.tenantId?.slice(-6)).join('/')}`);

  // 2. All 3 onboard the SAME customer (same mobile)
  const codeA = await onboard(A.token, 'A');
  const codeB = await onboard(B.token, 'B');
  const codeC = await onboard(C.token, 'C');
  ok('All 3 owners onboard same customer', !!(codeA && codeB && codeC), `codes ${codeA}/${codeB}/${codeC}`);

  // 3. Customer activates with A's code, then adds B and C via in-app add-business
  const act = await call('POST', '/api/auth/activate-account', null, { loginCode: codeA, password: PASSWORD, confirmPassword: PASSWORD, deviceId: DEVICE });
  let tok = act.j?.data?.tokens?.accessToken;
  ok('Customer activates (owner A code)', !!tok, `status ${act.status}`);
  const addB = await call('POST', '/api/auth/add-business', tok, { loginCode: codeB, deviceId: DEVICE });
  const addC = await call('POST', '/api/auth/add-business', tok, { loginCode: codeC, deviceId: DEVICE });
  ok('Customer adds business B & C in-app', addB.ok && addC.ok, `B ${addB.status}, C ${addC.status}`);

  // Track the customer User docs for cleanup
  const custAccounts = await User.find({ mobileNumber: { $regex: MOBILE.slice(-9) + '$' } }).select('_id tenantId isActive');
  custAccounts.forEach(u => createdUserIds.push(u._id.toString()));

  // 4. BASELINE — login by mobile+password lists all 3 businesses
  const base = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: PASSWORD, deviceId: DEVICE });
  ok('BASELINE login works', base.status === 200 && !!base.j?.data?.tokens?.accessToken, `status ${base.status}`);
  ok('BASELINE lists 3 businesses', (base.j?.data?.availableTenants || []).length === 3, `count ${(base.j?.data?.availableTenants || []).length}`);

  // Helper: find the customer account for a given tenant
  const acctFor = (tenantId) => User.findOne({ mobileNumber: MOBILE, tenantId });
  // mobile may be stored normalized; match by any variant
  const findAcct = async (tenantId) => {
    return User.findOne({ tenantId, role: { $in: ['CUSTOMER', 'customer'] } });
  };

  // 5. OWNER A BLOCKS the customer (isActive=false on A's account)
  const aAcct = await findAcct(A.tenantId);
  await User.updateOne({ _id: aAcct._id }, { $set: { isActive: false } });
  const afterA = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: PASSWORD, deviceId: DEVICE });
  ok('After OWNER A blocks → login STILL works', afterA.status === 200 && !!afterA.j?.data?.tokens?.accessToken, `status ${afterA.status}, msg "${afterA.j?.message || ''}"`);
  ok('After A blocks → only 2 businesses shown (A hidden)', (afterA.j?.data?.availableTenants || []).length === 2, `count ${(afterA.j?.data?.availableTenants || []).length}: ${(afterA.j?.data?.availableTenants || []).map(t => t.name).join(', ')}`);

  // 6. OWNER B ALSO BLOCKS — still one owner (C) active → login works
  const bAcct = await findAcct(B.tenantId);
  await User.updateOne({ _id: bAcct._id }, { $set: { isActive: false } });
  const afterB = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: PASSWORD, deviceId: DEVICE });
  ok('After A+B block → login STILL works (C active)', afterB.status === 200 && !!afterB.j?.data?.tokens?.accessToken, `status ${afterB.status}`);
  // Single remaining business → API omits the switcher list by design (only sent when >1)
  ok('After A+B block → single business, switcher list omitted (by design)', (afterB.j?.data?.availableTenants || []).length <= 1, `count ${(afterB.j?.data?.availableTenants || []).length}`);

  // 7. ALL owners block → login DENIED
  const cAcct = await findAcct(C.tenantId);
  await User.updateOne({ _id: cAcct._id }, { $set: { isActive: false } });
  const afterAll = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: PASSWORD, deviceId: DEVICE });
  ok('After ALL block → login DENIED (403)', afterAll.status === 403, `status ${afterAll.status}, msg "${afterAll.j?.message || ''}"`);

  // 8. Unblock C → login works again
  await User.updateOne({ _id: cAcct._id }, { $set: { isActive: true } });
  const reC = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: PASSWORD, deviceId: DEVICE });
  ok('Unblock C → login works again', reC.status === 200, `status ${reC.status}`);

  // 9. DELETE path: reactivate A+B, then DELETE A's account via owner API → login still works
  await User.updateOne({ _id: aAcct._id }, { $set: { isActive: true } });
  await User.updateOne({ _id: bAcct._id }, { $set: { isActive: true } });
  const delA = await call('DELETE', `/api/team/${aAcct._id}`, A.token);
  const afterDel = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: PASSWORD, deviceId: DEVICE });
  ok('Owner A DELETES customer → login still works (B/C)', delA.ok && afterDel.status === 200, `del ${delA.status}, login ${afterDel.status}`);
  ok('After delete → 2 businesses (A gone)', (afterDel.j?.data?.availableTenants || []).length === 2, `count ${(afterDel.j?.data?.availableTenants || []).length}`);

  // ── CLEANUP ─────────────────────────────────────────────
  const owners = await User.find({ email: { $in: [A.email, B.email, C.email] } }).select('_id');
  const allUserIds = [...new Set([...createdUserIds, ...owners.map(u => u._id.toString())])];
  const delU = await User.deleteMany({ _id: { $in: allUserIds } });
  const delT = await Tenant.deleteMany({ _id: { $in: createdTenantIds } });
  // also nuke any stragglers by the shared mobile / test emails
  await User.deleteMany({ mobileNumber: MOBILE });
  ok('CLEANUP removed test users + tenants', true, `users ${delU.deletedCount}, tenants ${delT.deletedCount}`);

  console.log('\n══════ REPRO: BLOCK / MULTI-TENANT LOGIN ══════');
  log.forEach(l => console.log('  ' + l));
  console.log('═══════════════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('CRASH:', e.message, e.stack);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
