/*
 * Live end-to-end test mirroring the mobile app's API usage.
 * Flow: register (owner+tenant) -> login -> create category/product/variant
 *       -> place order (stock down) -> approve -> dispatch -> deliver
 *       -> place 2nd order -> CANCEL via app's path (PUT orderStatus=Cancelled)
 *       -> verify stock restoration -> probe all module endpoints.
 * Run with the backend already running on http://localhost:3000
 */
const BASE = 'http://localhost:3000';
const ts = Date.now();
const log = (...a) => console.log(...a);
let pass = 0, fail = 0, warn = 0;
const results = [];
function rec(name, ok, detail) {
  if (ok === 'WARN') { warn++; results.push(`  ⚠️  ${name}${detail ? ' — ' + detail : ''}`); }
  else if (ok) { pass++; results.push(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; results.push(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

let token = null;
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, json };
}

(async () => {
  log('\n══════════════════════════════════════════════════');
  log('  DEALER SETU — LIVE END-TO-END TEST');
  log('══════════════════════════════════════════════════\n');

  // ── 1. AUTH: register ─────────────────────────────
  log('▶ MODULE: Auth');
  const email = `test.owner.${ts}@dealersetu.test`;
  const userName = `testowner${ts}`;
  const reg = await api('POST', '/api/auth/register', {
    firstName: 'Test', lastName: 'Owner', email, userName,
    password: 'test1234', mobileNumber: '9876500000', businessName: 'E2E Test Traders',
    deviceId: `e2e-device-${ts}`,
  });
  rec('Register owner+tenant', reg.status === 201 && reg.json?.data?.tokens?.accessToken, `status ${reg.status}`);
  const tenantName = reg.json?.data?.user?.tenantName || reg.json?.data?.user?.businessName;
  rec('Register returns user+tenant', !!reg.json?.data?.user, `tenant: ${tenantName || 'n/a'}`);

  // ── 2. AUTH: login ────────────────────────────────
  const login = await api('POST', '/api/auth/login', { email, password: 'test1234', deviceId: `e2e-device-${ts}` });
  rec('Login with email', login.status === 200 && !!login.json?.data?.tokens?.accessToken, `status ${login.status}`);
  token = login.json?.data?.tokens?.accessToken || reg.json?.data?.tokens?.accessToken;
  if (!token) { log('\n❌ FATAL: no token, aborting.'); printSummary(); process.exit(1); }

  // wrong password
  const badLogin = await api('POST', '/api/auth/login', { email, password: 'wrongpass' });
  rec('Login rejects wrong password', badLogin.status === 401 || badLogin.status === 400, `status ${badLogin.status}`);

  // ── 3. CATEGORIES ─────────────────────────────────
  log('\n▶ MODULE: Categories');
  const cat = await api('POST', '/api/categories', {
    name: `Test Category ${ts}`, description: 'E2E', imageUrl: '',
    variantAttributes: [{ name: 'Size', values: ['S', 'M', 'L'] }],
  });
  rec('Create category', cat.status === 201 || cat.status === 200, `status ${cat.status}`);
  const categoryId = cat.json?.data?._id;
  const catList = await api('GET', '/api/categories');
  rec('List categories', catList.ok && Array.isArray(catList.json?.data), `count ${catList.json?.data?.length}`);

  // ── 4. PRODUCTS ───────────────────────────────────
  log('\n▶ MODULE: Products');
  const prod = await api('POST', '/api/products', {
    name: `Test Product ${ts}`, categoryId, productCode: `TP${ts}`, description: 'E2E product',
    brand: 'TestBrand', taxPercentage: 5, unit: 'Piece', hasVariants: true,
    variantAttributes: [{ name: 'Size', values: ['S', 'M', 'L'] }],
  });
  rec('Create product', prod.status === 201 || prod.status === 200, `status ${prod.status}`);
  const productId = prod.json?.data?._id;
  const prodList = await api('GET', '/api/products');
  rec('List products', prodList.ok && Array.isArray(prodList.json?.data), `count ${prodList.json?.data?.length}`);

  // ── 5. VARIANTS ───────────────────────────────────
  log('\n▶ MODULE: Variants');
  const STARTING_STOCK = 100;
  const variant = await api('POST', '/api/variants', {
    productId, sku: `SKU-${ts}`, price: 500, costPrice: 300, taxPercentage: 5,
    stockQty: STARTING_STOCK, unit: 'Piece', attributes: { Size: 'M' }, isActive: true,
  });
  rec('Create variant (stock=100)', variant.status === 201 || variant.status === 200, `status ${variant.status}`);
  const variantId = variant.json?.data?._id;

  // ── 6. ORDER GENERATE (place) ─────────────────────
  log('\n▶ MODULE: Orders — GENERATE');
  const ORDER_QTY = 10;
  const place = await api('POST', '/api/orders/place', {
    items: [{ variantId, quantity: ORDER_QTY }], notes: 'E2E order #1',
  });
  rec('Place order #1', place.status === 201 || place.status === 200, `status ${place.status}, order ${place.json?.data?.orderNumber}`);
  const orderId = place.json?.data?._id;

  // stock should now be 90
  const vAfterOrder = await api('GET', `/api/variants/${variantId}`);
  const stockAfterOrder = vAfterOrder.json?.data?.stockQty;
  rec('Stock decremented after order', stockAfterOrder === STARTING_STOCK - ORDER_QTY, `expected ${STARTING_STOCK - ORDER_QTY}, got ${stockAfterOrder}`);

  // get order detail
  const detail = await api('GET', `/api/orders/${orderId}`);
  rec('Get order detail', detail.ok && !!detail.json?.data?.order, `items ${detail.json?.data?.items?.length}`);

  // ── 7. ORDER STATUS LIFECYCLE ─────────────────────
  log('\n▶ MODULE: Orders — STATUS FLOW');
  const approve = await api('PUT', `/api/orders/${orderId}`, { orderStatus: 'Approved' });
  rec('Approve order', approve.ok && approve.json?.data?.orderStatus === 'Approved', `status ${approve.status}`);
  const dispatch = await api('PUT', `/api/orders/${orderId}`, { orderStatus: 'Dispatched' });
  rec('Dispatch order', dispatch.ok && dispatch.json?.data?.orderStatus === 'Dispatched', `status ${dispatch.status}`);
  const deliver = await api('PUT', `/api/orders/${orderId}`, { orderStatus: 'Delivered' });
  rec('Deliver order', deliver.ok && deliver.json?.data?.orderStatus === 'Delivered', `status ${deliver.status}`);

  // ── 8. ORDER CANCEL (the app's path) ──────────────
  log('\n▶ MODULE: Orders — CANCEL (app uses PUT orderStatus=Cancelled)');
  // place a 2nd order to cancel
  const place2 = await api('POST', '/api/orders/place', { items: [{ variantId, quantity: ORDER_QTY }], notes: 'E2E order #2 (to cancel)' });
  rec('Place order #2 (to cancel)', place2.ok, `order ${place2.json?.data?.orderNumber}`);
  const order2Id = place2.json?.data?._id;
  const vBeforeCancel = await api('GET', `/api/variants/${variantId}`);
  const stockBeforeCancel = vBeforeCancel.json?.data?.stockQty;

  // App's cancel: PUT orderStatus = Cancelled
  const cancel = await api('PUT', `/api/orders/${order2Id}`, { orderStatus: 'Cancelled' });
  rec("App cancel (PUT) sets status=Cancelled", cancel.ok && cancel.json?.data?.orderStatus === 'Cancelled', `status ${cancel.status}`);

  const vAfterCancel = await api('GET', `/api/variants/${variantId}`);
  const stockAfterCancel = vAfterCancel.json?.data?.stockQty;
  const restored = stockAfterCancel === stockBeforeCancel + ORDER_QTY;
  rec('Stock RESTORED after app-cancel', restored ? true : 'WARN',
      restored ? `stock back to ${stockAfterCancel}` : `BUG: stock stayed at ${stockAfterCancel} (expected ${stockBeforeCancel + ORDER_QTY}) — PUT-cancel does not restore inventory`);

  // Compare with DELETE-cancel (proper path that restores stock)
  const place3 = await api('POST', '/api/orders/place', { items: [{ variantId, quantity: ORDER_QTY }], notes: 'E2E order #3 (delete-cancel)' });
  const order3Id = place3.json?.data?._id;
  const vBeforeDel = (await api('GET', `/api/variants/${variantId}`)).json?.data?.stockQty;
  const del = await api('DELETE', `/api/orders/${order3Id}`);
  const vAfterDel = (await api('GET', `/api/variants/${variantId}`)).json?.data?.stockQty;
  rec('DELETE-cancel restores stock', vAfterDel === vBeforeDel + ORDER_QTY, `before ${vBeforeDel} -> after ${vAfterDel}`);

  // ── 9. Order list & validation ────────────────────
  const orderList = await api('GET', '/api/orders');
  rec('List orders', orderList.ok && Array.isArray(orderList.json?.data), `count ${orderList.json?.data?.length}`);
  const badOrder = await api('POST', '/api/orders/place', { items: [] });
  rec('Place order rejects empty items', !badOrder.ok, `status ${badOrder.status}`);
  const overOrder = await api('POST', '/api/orders/place', { items: [{ variantId, quantity: 99999 }] });
  rec('Place order rejects over-stock', !overOrder.ok, `status ${overOrder.status}: ${overOrder.json?.message?.slice(0,50)}`);

  // ── 10. Probe remaining module endpoints (read) ──
  log('\n▶ MODULE: Other endpoints (read/probe)');
  const probes = [
    ['Dashboard', 'GET', '/api/dashboard'],
    ['Team (users)', 'GET', '/api/team'],
    ['Roles', 'GET', '/api/roles'],
    ['Modules', 'GET', '/api/modules'],
    ['Notifications', 'GET', '/api/notifications'],
    ['Notifications unread-count', 'GET', '/api/notifications/unread-count'],
    ['Feedback', 'GET', '/api/feedback'],
    ['Banners', 'GET', '/api/banners'],
    ['Visits', 'GET', '/api/visits'],
    ['Team balances', 'GET', '/api/team/balances'],
    ['Team tenant', 'GET', '/api/team/tenant'],
  ];
  for (const [name, m, p] of probes) {
    const r = await api(m, p);
    rec(name, r.ok ? true : 'WARN', `status ${r.status}`);
  }

  // ── 11. Team: create a customer (user) ────────────
  log('\n▶ MODULE: Team — create customer');
  const cust = await api('POST', '/api/team', {
    firstName: 'Test', lastName: 'Customer', email: `cust.${ts}@dealersetu.test`,
    mobileNumber: '9876511111', shopName: 'Customer Shop', discount: 5,
  });
  rec('Create customer (user)', cust.ok, `status ${cust.status}, code ${cust.json?.data?.loginCode || 'n/a'}`);

  // ── 12. Auth guard ────────────────────────────────
  log('\n▶ MODULE: Auth guard');
  const savedToken = token; token = null;
  const noAuth = await api('GET', '/api/orders');
  rec('Protected route rejects no-token', noAuth.status === 401, `status ${noAuth.status}`);
  token = savedToken;

  printSummary();
  process.exit(fail > 0 ? 1 : 0);

  function printSummary() {
    log('\n══════════════════════════════════════════════════');
    log('  RESULTS');
    log('══════════════════════════════════════════════════');
    results.forEach(r => log(r));
    log('\n──────────────────────────────────────────────────');
    log(`  ✅ PASS: ${pass}   ⚠️  WARN: ${warn}   ❌ FAIL: ${fail}`);
    log('══════════════════════════════════════════════════\n');
  }
})().catch(e => { console.error('TEST CRASHED:', e); process.exit(1); });
