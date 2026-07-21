/*
 * E2E: full block → unblock-request → owner notified → unblock loop.
 * Uses ONLY the real HTTP APIs (owner block, customer my-businesses / unblock-request,
 * owner notifications, owner unblock). Cleans up all created entities.
 *
 * Run (server must be up on :3000): node src/scripts/reproUnblockLoop.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const Notification = require('../models/notificationModel');

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
async function onboard(ownerToken) {
  const r = await call('POST', '/api/team', ownerToken, { firstName: 'Shared', lastName: 'Cust', mobileNumber: MOBILE, shopName: 'Shop' });
  return r.j?.data?.loginCode;
}

const createdTenantIds = [];

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Setup: 3 owners + shared customer (activate A, add B & C)
  const A = await registerOwner('A', '1');
  const B = await registerOwner('B', '2');
  const C = await registerOwner('C', '3');
  [A, B, C].forEach(o => o.tenantId && createdTenantIds.push(o.tenantId));
  const codeA = await onboard(A.token);
  await onboard(B.token);
  const codeC = await onboard(C.token); // (B added by direct code below via activate? no — use add-business)
  const codeB = await (async () => {
    // re-onboard B to fetch its code deterministically
    const r = await call('POST', '/api/team', B.token, { firstName: 'Shared', lastName: 'Cust', mobileNumber: MOBILE, shopName: 'Shop' });
    return r.j?.data?.loginCode;
  })();

  const act = await call('POST', '/api/auth/activate-account', null, { loginCode: codeA, password: PASSWORD, confirmPassword: PASSWORD, deviceId: DEVICE });
  const custTok = act.j?.data?.tokens?.accessToken;
  await call('POST', '/api/auth/add-business', custTok, { loginCode: codeB, deviceId: DEVICE });
  await call('POST', '/api/auth/add-business', custTok, { loginCode: codeC, deviceId: DEVICE });
  ok('Setup: 3 owners + activated multi-tenant customer', !!custTok);

  // Owner A finds the customer in their team list → get the member id
  const teamA = await call('GET', '/api/team', A.token);
  const memberA = (teamA.j?.data || []).find(m => m.mobileNumber === MOBILE || m.mobileNumber?.endsWith(MOBILE.slice(-9)));
  ok('Owner A sees the customer in team', !!memberA, `id ${memberA?.id?.slice(-6)}`);

  // 1. Owner A BLOCKS the customer (real API)
  const block = await call('PUT', `/api/team/${memberA.id}/block`, A.token, { blocked: true });
  ok('Owner A blocks customer (PUT /team/:id/block)', block.status === 200 && block.j?.data?.isActive === false, `status ${block.status}, isActive ${block.j?.data?.isActive}`);

  // 2. Customer login still works (B/C), A excluded from switcher
  const login = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: PASSWORD, deviceId: DEVICE });
  ok('Customer still logs in after A blocks', login.status === 200 && !!login.j?.data?.tokens?.accessToken, `status ${login.status}`);
  const custTok2 = login.j?.data?.tokens?.accessToken || custTok;
  const avail = login.j?.data?.availableTenants || [];
  ok('Blocked owner A NOT in login switcher', !avail.some(t => t.id === A.tenantId), `tenants: ${avail.map(t => t.name).join(', ')}`);

  // 3. Customer my-businesses shows A as blocked
  const biz = await call('GET', '/api/auth/my-businesses', custTok2);
  const aBiz = (biz.j?.data || []).find(x => x.tenantId === A.tenantId);
  ok('Customer sees business A flagged blocked', !!aBiz && aBiz.blocked === true, `blocked ${aBiz?.blocked}, unblockRequested ${aBiz?.unblockRequested}`);

  // 4. Customer requests unblock
  const reqU = await call('POST', `/api/auth/my-businesses/${A.tenantId}/unblock-request`, custTok2, {});
  ok('Customer sends unblock request', reqU.status === 200 && reqU.j?.data?.unblockRequested === true, `status ${reqU.status}`);
  const biz2 = await call('GET', '/api/auth/my-businesses', custTok2);
  const aBiz2 = (biz2.j?.data || []).find(x => x.tenantId === A.tenantId);
  ok('my-businesses now shows unblockRequested', !!aBiz2 && aBiz2.unblockRequested === true, `unblockRequested ${aBiz2?.unblockRequested}`);

  // 5. Owner A receives a customer_unblock_request notification
  const notifs = await call('GET', '/api/notifications', A.token);
  const hasNotif = (notifs.j?.data || []).some(n => n.type === 'customer_unblock_request');
  ok('Owner A got customer_unblock_request notification', hasNotif, `notifs ${(notifs.j?.data || []).length}`);

  // 6. Owner team list shows the customer blocked + unblockRequested
  const teamA2 = await call('GET', '/api/team', A.token);
  const memberA2 = (teamA2.j?.data || []).find(m => m.id === memberA.id);
  ok('Owner list: customer isActive=false + unblockRequested=true', memberA2?.isActive === false && memberA2?.unblockRequested === true, `isActive ${memberA2?.isActive}, unblockRequested ${memberA2?.unblockRequested}`);

  // 7. Owner A UNBLOCKS
  const unblock = await call('PUT', `/api/team/${memberA.id}/block`, A.token, { blocked: false });
  ok('Owner A unblocks customer', unblock.status === 200 && unblock.j?.data?.isActive === true, `status ${unblock.status}, isActive ${unblock.j?.data?.isActive}`);

  // 8. unblockRequested cleared + A back in switcher
  const teamA3 = await call('GET', '/api/team', A.token);
  const memberA3 = (teamA3.j?.data || []).find(m => m.id === memberA.id);
  ok('After unblock: request cleared, active again', memberA3?.isActive === true && memberA3?.unblockRequested === false, `isActive ${memberA3?.isActive}, unblockRequested ${memberA3?.unblockRequested}`);
  const login2 = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: PASSWORD, deviceId: DEVICE });
  const avail2 = login2.j?.data?.availableTenants || [];
  ok('Owner A back in login switcher after unblock', avail2.some(t => t.id === A.tenantId), `tenants: ${avail2.map(t => t.name).join(', ')}`);

  // ── CLEANUP ─────────────────────────────────────────────
  const owners = await User.find({ email: { $in: [A.email, B.email, C.email] } }).select('_id');
  await User.deleteMany({ mobileNumber: MOBILE });
  await User.deleteMany({ _id: { $in: owners.map(o => o._id) } });
  await Tenant.deleteMany({ _id: { $in: createdTenantIds } });
  await Notification.deleteMany({ tenantId: { $in: createdTenantIds } });
  ok('CLEANUP done', true);

  console.log('\n══════ E2E: BLOCK → UNBLOCK-REQUEST → UNBLOCK LOOP ══════');
  log.forEach(l => console.log('  ' + l));
  console.log('═════════════════════════════════════════════════════════\n');

  await mongoose.disconnect();
  process.exit(0);
})().catch(async (e) => {
  console.error('CRASH:', e.message, e.stack);
  try { await mongoose.disconnect(); } catch {}
  process.exit(1);
});
