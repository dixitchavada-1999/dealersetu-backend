/**
 * Full-platform E2E smoke test — exercises EVERY module end-to-end via the live HTTP API.
 *
 * Creates a fresh throw-away tenant/owner, then runs real CRUD + workflow flows for:
 *   Auth · Settings · Dashboard · Categories · Products(simple+variant) · Variants ·
 *   Customers · Orders(place→approve→dispatch→deliver→edit-charges→pay) · Roles+activation ·
 *   Dispatch/Production/Marketing staff · Banners · Feedback · Visits · Notifications ·
 *   Modules · Super-admin (tenants/detail/activity-logs/module-update)
 *
 * Run with the API server already listening on :3000 — `node src/scripts/e2eAllModules.js`
 */
require('dotenv').config();

const API = 'http://localhost:3000/api';
const MASTER = process.env.MASTER_PASSWORD || '666666';
const SA_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'superadmin@platform.com';
const STAMP = Date.now();

const c = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m' };
const log = {
  section: (m) => console.log(`\n${c.bold}${c.cyan}━━━━ ${m} ━━━━${c.reset}`),
  pass: (m) => console.log(`    ${c.green}✓${c.reset} ${m}`),
  fail: (m, d) => console.log(`    ${c.red}✗${c.reset} ${m}${d ? c.dim + ' — ' + d + c.reset : ''}`),
  info: (m) => console.log(`    ${c.dim}${m}${c.reset}`),
};

let pass = 0, fail = 0;
const failures = [];
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; log.pass(name); } else { fail++; failures.push(name); log.fail(name, detail); }
  return !!cond;
};

const req = async (method, path, { token, body } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res, data = null;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    try { data = await res.json(); } catch (_) {}
    return { status: res.status, data, ok: res.ok };
  } catch (e) {
    return { status: 0, data: { message: e.message }, ok: false };
  }
};
const get = (p, token) => req('GET', p, { token });
const post = (p, body, token) => req('POST', p, { token, body });
const put = (p, body, token) => req('PUT', p, { token, body });
const patch = (p, body, token) => req('PATCH', p, { token, body });
const del = (p, token) => req('DELETE', p, { token });

// Pull a token out of whatever shape the auth endpoints return
const tokenOf = (r) => {
  const d = r?.data?.data ?? r?.data ?? {};
  return d?.tokens?.accessToken || d?.accessToken || d?.token || d?.tokens?.token || null;
};
// Pull the payload (`data` or `data.data`) generically
const payloadOf = (r) => r?.data?.data ?? r?.data;
const idOf = (obj) => obj?._id || obj?.id;
const msg = (r) => r?.data?.message || `HTTP ${r?.status}`;

(async () => {
  console.log(`${c.bold}Full-platform E2E — stamp ${STAMP}${c.reset}`);

  let token, tenantId, catId, simpleProductId, variantProductId, variantId, customerId, orderId;
  let dispatchRoleId, productionRoleId, marketingRoleId, bannerId, feedbackId, visitId;

  // ── 1. AUTH ──────────────────────────────────────────────
  log.section('1. Auth — register owner + login');
  const ownerEmail = `e2e-owner-${STAMP}@test.local`;
  let r = await post('/auth/register', {
    firstName: 'E2E', lastName: 'Owner', email: ownerEmail, userName: `e2eowner${STAMP}`,
    password: 'Test1234', mobileNumber: `9${String(STAMP).slice(-9)}`, businessName: `E2E Co ${STAMP}`, deviceId: 'e2e',
  });
  ok(r.status === 201 || r.status === 200, 'Register owner', msg(r));
  token = tokenOf(r);
  const owner = payloadOf(r)?.user || payloadOf(r);
  tenantId = owner?.tenant?._id || owner?.tenant?.id || owner?.tenantId || owner?.tenant;
  if (!ok(!!token, 'Register returned access token')) {
    // fall back to login
    r = await post('/auth/login', { email: ownerEmail, password: 'Test1234', deviceId: 'e2e' });
    token = tokenOf(r);
    ok(!!token, 'Login owner', msg(r));
  }
  if (!token) { console.log(`${c.red}No owner token — aborting.${c.reset}`); process.exit(1); }
  log.info(`tenantId: ${tenantId || '(read later)'}`);

  // ── 2. SETTINGS ──────────────────────────────────────────
  log.section('2. Settings — tenant read/update');
  r = await get('/team/tenant', token);
  ok(r.ok, 'GET tenant settings', msg(r));
  if (!tenantId) tenantId = idOf(payloadOf(r));
  r = await put('/team/tenant', { businessName: `E2E Co ${STAMP} (edited)`, lowStockThreshold: 7, commonDiscount: 5 }, token);
  ok(r.ok, 'PUT tenant settings (business + discount + threshold)', msg(r));

  // ── 3. DASHBOARD ─────────────────────────────────────────
  log.section('3. Dashboard');
  r = await get('/dashboard', token);
  ok(r.ok, 'GET dashboard stats', msg(r));

  // ── 4. CATEGORIES ────────────────────────────────────────
  log.section('4. Categories — CRUD');
  r = await post('/categories', { name: `Cat ${STAMP}`, description: 'e2e cat', variantAttributes: [{ name: 'Size', values: ['S', 'M', 'L'] }] }, token);
  ok(r.status === 201, 'Create category', msg(r));
  catId = idOf(payloadOf(r));
  r = await get('/categories', token);
  ok(r.ok && Array.isArray(payloadOf(r)) , 'List categories', msg(r));
  r = await put(`/categories/${catId}`, { name: `Cat ${STAMP} edited`, description: 'updated' }, token);
  ok(r.ok, 'Update category', msg(r));

  // ── 5. PRODUCTS (simple) ─────────────────────────────────
  log.section('5. Products — simple (no variants)');
  r = await post('/products', {
    name: `Simple Product ${STAMP}`, categoryId: catId, productCode: `SP-${STAMP}`, brand: 'E2E',
    unit: 'Piece', description: 'simple', costPrice: 50, taxPercentage: 18, hasVariants: false,
    price: 120, sku: `SKU-S-${STAMP}`, stockQty: 100,
  }, token);
  ok(r.status === 201, 'Create simple product', msg(r));
  simpleProductId = idOf(payloadOf(r));
  r = await get('/products', token);
  ok(r.ok, 'List products', msg(r));
  r = await get(`/products/${simpleProductId}`, token);
  ok(r.ok, 'Get product by id', msg(r));
  r = await put(`/products/${simpleProductId}`, { name: `Simple Product ${STAMP} edited`, price: 130 }, token);
  ok(r.ok, 'Update product', msg(r));

  // ── 6. PRODUCTS (variant) + VARIANTS ─────────────────────
  log.section('6. Products — with variants + Variants CRUD');
  r = await post('/products', {
    name: `Variant Product ${STAMP}`, categoryId: catId, productCode: `VP-${STAMP}`, brand: 'E2E',
    unit: 'Piece', costPrice: 80, taxPercentage: 12, hasVariants: true,
    variantAttributes: [{ name: 'Size', values: ['S', 'M'] }],
  }, token);
  ok(r.status === 201, 'Create variant-parent product', msg(r));
  variantProductId = idOf(payloadOf(r));
  r = await post('/variants', {
    productId: variantProductId, sku: `VAR-${STAMP}-S`, price: 200, costPrice: 80, taxPercentage: 12,
    unit: 'Piece', stockQty: 40, attributes: [{ name: 'Size', value: 'S' }],
  }, token);
  ok(r.status === 201, 'Create variant', msg(r));
  variantId = idOf(payloadOf(r));
  r = await get('/variants', token);
  ok(r.ok, 'List variants', msg(r));
  r = await patch(`/variants/${variantId}/stock`, { stockQty: 55 }, token);
  ok(r.ok, 'Update variant stock', msg(r));
  r = await put(`/variants/${variantId}`, { price: 210 }, token);
  ok(r.ok, 'Update variant', msg(r));

  // ── 7. CUSTOMERS ─────────────────────────────────────────
  log.section('7. Customers — CRUD + balances');
  r = await post('/customers', { name: `Customer ${STAMP}`, mobile: `8${String(STAMP).slice(-9)}`, email: `cust-${STAMP}@test.local`, shopName: 'E2E Shop', gstNumber: '24ABCDE1234F1Z5', address: { city: 'Surat', state: 'GJ', pincode: '395001' } }, token);
  ok(r.status === 201, 'Create customer', msg(r));
  customerId = idOf(payloadOf(r));
  r = await get('/customers', token);
  ok(r.ok, 'List customers', msg(r));
  r = await put(`/customers/${customerId}`, { shopName: 'E2E Shop edited', discount: 3 }, token);
  ok(r.ok, 'Update customer', msg(r));
  r = await get('/team/balances', token);
  ok(r.ok, 'Get customer balances', msg(r));

  // ── 8. ORDERS (full workflow) ────────────────────────────
  log.section('8. Orders — place → approve → dispatch → deliver → edit-charges → pay');
  r = await post('/orders/place', { items: [{ productId: simpleProductId, quantity: 3 }], notes: 'e2e order' }, token);
  ok(r.status === 201 || r.status === 200, 'Place order (simple product)', msg(r));
  orderId = idOf(payloadOf(r));
  r = await get('/orders', token);
  ok(r.ok, 'List orders', msg(r));
  if (orderId) {
    r = await get(`/orders/${orderId}`, token);
    ok(r.ok, 'Get order by id', msg(r));
    r = await put(`/orders/${orderId}`, { orderStatus: 'Approved' }, token);
    ok(r.ok && payloadOf(r)?.orderStatus === 'Approved', 'Approve order', msg(r));
    // edit charges must happen before delivery (delivered/cancelled orders are locked — correct rule)
    r = await put(`/orders/${orderId}/edit`, { courierCharge: 40, additionalDiscount: 10, additionalCharge: 5, additionalChargeNote: 'handling' }, token);
    ok(r.ok, 'Edit order charges (while Approved)', msg(r));
    r = await put(`/orders/${orderId}`, { orderStatus: 'Dispatched', deliveryNotes: 'on the way' }, token);
    ok(r.ok && payloadOf(r)?.orderStatus === 'Dispatched', 'Dispatch order', msg(r));
    r = await put(`/orders/${orderId}`, { paidAmount: 100, paymentStatus: 'Partial' }, token);
    ok(r.ok, 'Record partial payment', msg(r));
    r = await put(`/orders/${orderId}`, { orderStatus: 'Delivered' }, token);
    ok(r.ok && payloadOf(r)?.orderStatus === 'Delivered', 'Deliver order', msg(r));
  } else {
    log.info('No orderId — skipping order workflow steps');
  }

  // ── 9. ROLES + activation ────────────────────────────────
  log.section('9. Roles — list, catalog, activate dynamic roles');
  r = await get('/roles', token);
  ok(r.ok, 'List roles (owner view)', msg(r));
  const rp = payloadOf(r);
  const roles = Array.isArray(rp) ? rp : (rp?.roles || []);
  const findRole = (slug) => roles.find((x) => x.slug === slug);
  dispatchRoleId = idOf(findRole('dispatch') || {});
  productionRoleId = idOf(findRole('production') || {});
  marketingRoleId = idOf(findRole('marketing') || {});
  r = await get('/roles/catalog', token);
  ok(r.ok, 'Get permission catalog', msg(r));
  for (const [slug, id] of [['dispatch', dispatchRoleId], ['production', productionRoleId], ['marketing', marketingRoleId]]) {
    if (id) {
      r = await patch(`/roles/${id}/activation`, { active: true }, token);
      ok(r.ok, `Activate ${slug} role`, msg(r));
    } else {
      ok(false, `Found ${slug} role in catalog`, 'role missing from owner role list');
    }
  }

  // re-login: activating roles may bump permissionVersion and invalidate the token
  r = await post('/auth/login', { email: ownerEmail, password: 'Test1234', deviceId: 'e2e' });
  if (tokenOf(r)) { token = tokenOf(r); log.info('re-logged in after role activation'); }

  // ── 10. STAFF (dispatch / production / marketing) ────────
  log.section('10. Staff — Dispatch / Production / Marketing CRUD');
  const staffDefs = [
    ['dispatch', '/team/dispatch'],
    ['production', '/team/production'],
    ['marketing', '/team/marketing'],
  ];
  const createdStaff = {};
  for (const [name, base] of staffDefs) {
    r = await post(base, { firstName: name, lastName: 'Staff', email: `${name}-${STAMP}@test.local`, password: 'Staff1234', mobileNumber: `7${String(STAMP).slice(-8)}${name[0]}` }, token);
    if (ok(r.status === 201 || r.status === 200, `Create ${name} user`, msg(r))) {
      createdStaff[name] = idOf(payloadOf(r)?.user || payloadOf(r));
    }
    r = await get(base, token);
    ok(r.ok, `List ${name} users`, msg(r));
  }
  // permission update + delete for dispatch as a representative
  r = await put('/team/dispatch-permissions', { dashboard: true, products: true, orders: true, categories: false }, token);
  ok(r.ok, 'Update dispatch permissions', msg(r));
  if (createdStaff.dispatch) {
    r = await put(`/team/dispatch/${createdStaff.dispatch}`, { lastName: 'Edited' }, token);
    ok(r.ok, 'Update dispatch user', msg(r));
    r = await del(`/team/dispatch/${createdStaff.dispatch}`, token);
    ok(r.ok, 'Delete dispatch user', msg(r));
  }

  // ── 11. BANNERS / PROMOTIONS ─────────────────────────────
  log.section('11. Promotions — Banners CRUD');
  r = await post('/banners', { title: `Banner ${STAMP}`, description: 'e2e', imageUrl: 'https://example.com/b.jpg', mediaType: 'image', linkType: 'none', priority: 1 }, token);
  ok(r.status === 201, 'Create banner', msg(r));
  bannerId = idOf(payloadOf(r));
  r = await get('/banners', token);
  ok(r.ok, 'List banners', msg(r));
  if (bannerId) {
    r = await put(`/banners/${bannerId}`, { title: `Banner ${STAMP} edited`, priority: 2 }, token);
    ok(r.ok, 'Update banner', msg(r));
    r = await del(`/banners/${bannerId}`, token);
    ok(r.ok, 'Delete banner', msg(r));
  }

  // ── 12. FEEDBACK ─────────────────────────────────────────
  log.section('12. Feedback — create + list + reply');
  r = await post('/feedback', { type: 'general', rating: 5, comment: 'great e2e' }, token);
  ok(r.status === 201 || r.status === 200, 'Create feedback (general)', msg(r));
  feedbackId = idOf(payloadOf(r));
  r = await get('/feedback/all', token);
  ok(r.ok, 'List all feedback', msg(r));
  if (feedbackId) {
    r = await put(`/feedback/${feedbackId}/reply`, { reply: 'thanks for the feedback' }, token);
    ok(r.ok, 'Admin reply to feedback', msg(r));
  }

  // ── 13. VISITS ───────────────────────────────────────────
  log.section('13. Visits — create + list + stats + approve');
  r = await post('/visits', { customerName: `Visit Lead ${STAMP}`, customerPhone: `6${String(STAMP).slice(-9)}`, shopName: 'Lead Shop', address: 'Surat', gstNumber: '24AAAAA0000A1Z5', notes: 'e2e visit' }, token);
  ok(r.status === 201 || r.status === 200, 'Create visit', msg(r));
  visitId = idOf(payloadOf(r));
  r = await get('/visits', token);
  ok(r.ok, 'List visits', msg(r));
  r = await get('/visits/stats', token);
  ok(r.ok, 'Visit stats', msg(r));
  if (visitId) {
    r = await put(`/visits/${visitId}/approve`, {}, token);
    ok(r.ok, 'Approve visit (creates customer)', msg(r));
  }

  // ── 14. NOTIFICATIONS ────────────────────────────────────
  log.section('14. Notifications');
  r = await get('/notifications', token);
  ok(r.ok, 'List notifications', msg(r));
  r = await get('/notifications/unread-count', token);
  ok(r.ok, 'Unread count', msg(r));
  r = await put('/notifications/read-all', {}, token);
  ok(r.ok, 'Mark all read', msg(r));

  // ── 15. MODULES ──────────────────────────────────────────
  log.section('15. Modules — list (DB-driven menu)');
  r = await get('/modules', token);
  ok(r.ok, 'GET /modules', msg(r));
  const mods = payloadOf(r);
  const modList = Array.isArray(mods) ? mods : (mods?.modules || []);
  ok(modList.length > 0, 'Modules catalog non-empty', `count=${modList.length}`);

  // ── 16. SUPER-ADMIN ──────────────────────────────────────
  log.section('16. Super-admin — tenants / detail / activity-logs / module update');
  r = await post('/auth/login', { email: SA_EMAIL, password: MASTER, deviceId: 'e2e-sa' });
  let saToken = tokenOf(r);
  if (!saToken) {
    // master password may require the real password; try the seed default
    r = await post('/auth/login', { email: SA_EMAIL, password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!', deviceId: 'e2e-sa' });
    saToken = tokenOf(r);
  }
  if (ok(!!saToken, 'Super-admin login', msg(r))) {
    r = await get('/super-admin/tenants', saToken);
    ok(r.ok, 'List tenants', msg(r));
    r = await get(`/super-admin/tenants/${tenantId}`, saToken);
    ok(r.ok, 'Tenant detail (our e2e tenant)', msg(r));
    r = await get(`/super-admin/tenants/${tenantId}/orders`, saToken);
    ok(r.ok, 'Tenant orders drilldown', msg(r));
    r = await get('/super-admin/activity-logs', saToken);
    ok(r.ok, 'Activity logs', msg(r));
    // module type/under-development update
    r = await put('/modules/marketing', { underDevelopment: true }, saToken);
    ok(r.ok, 'Super-admin set module under-development', msg(r));
    r = await put('/modules/marketing', { underDevelopment: false }, saToken);
    ok(r.ok, 'Super-admin clear module under-development', msg(r));
  } else {
    log.info(`Super-admin (${SA_EMAIL}) not available — run: node src/scripts/seedSuperAdmin.js`);
  }

  // ── SUMMARY ──────────────────────────────────────────────
  console.log(`\n${c.bold}${fail === 0 ? c.green : c.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`);
  console.log(`${c.bold}Result: ${c.green}${pass} passed${c.reset}, ${fail ? c.red : c.dim}${fail} failed${c.reset}`);
  if (fail) console.log(`${c.red}Failed: ${failures.join(', ')}${c.reset}`);
  console.log(`${c.dim}Test tenant: E2E Co ${STAMP} (owner ${ownerEmail})${c.reset}\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.error(`${c.red}FATAL:${c.reset}`, e); process.exit(2); });
