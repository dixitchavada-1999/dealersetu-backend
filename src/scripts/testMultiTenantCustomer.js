/*
 * Multi-tenant customer flow: ONE customer (same mobile) onboarded by TWO owners.
 * Verifies: availableTenants, switch-tenant, per-tenant data isolation (products/orders).
 */
const BASE = 'http://localhost:3000';
const ts = Date.now();
const MOBILE = `9${String(ts).slice(-9)}`; // shared customer mobile
let log = [];
const ok = (n, c, d) => log.push(`${c ? '✅' : '❌'} ${n}${d ? ' — ' + d : ''}`);

async function call(method, path, token, body) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, j };
}
async function registerOwner(tag) {
  const email = `owner_${tag}_${ts}@x.test`;
  const r = await call('POST', '/api/auth/register', null, { firstName: 'Own', lastName: tag, email, userName: `own_${tag}_${ts}`, password: 'Owner@123', mobileNumber: `8${String(ts).slice(-9)}${tag === 'A' ? '1' : '2'}`.slice(0, 10), businessName: `Business ${tag}` });
  return { token: r.j?.data?.tokens?.accessToken, tenantId: r.j?.data?.user?.tenantId, email };
}
async function makeCatalog(token, tag) {
  const cat = await call('POST', '/api/categories', token, { name: `Cat ${tag} ${ts}`, variantAttributes: [{ name: 'Size', values: ['M'] }] });
  const prod = await call('POST', '/api/products', token, { name: `PROD-${tag}-${ts}`, categoryId: cat.j?.data?._id, productCode: `P${tag}${ts}`, unit: 'Piece', hasVariants: true });
  const v = await call('POST', '/api/variants', token, { productId: prod.j?.data?._id, sku: `SKU-${tag}-${ts}`, price: 100, stockQty: 50, unit: 'Piece', attributes: { Size: 'M' }, isActive: true });
  return { productName: `PROD-${tag}-${ts}`, variantId: v.j?.data?._id };
}

(async () => {
  // 1. Two owners (two tenants)
  const A = await registerOwner('A');
  const B = await registerOwner('B');
  ok('Owner A + B registered (2 tenants)', A.token && B.token && A.tenantId !== B.tenantId, `A=${A.tenantId?.slice(-6)} B=${B.tenantId?.slice(-6)}`);

  // 2. Each owner builds a distinct catalog
  const catA = await makeCatalog(A.token, 'A');
  const catB = await makeCatalog(B.token, 'B');
  ok('Catalog A + B created', !!catA.variantId && !!catB.variantId);

  // 3. Both owners onboard the SAME customer (same mobile)
  const custA = await call('POST', '/api/team', A.token, { firstName: 'Shared', lastName: 'Cust', mobileNumber: MOBILE, shopName: 'SharedShop' });
  const custB = await call('POST', '/api/team', B.token, { firstName: 'Shared', lastName: 'Cust', mobileNumber: MOBILE, shopName: 'SharedShop' });
  const codeA = custA.j?.data?.loginCode;
  ok('Owner A onboards customer (mobile ' + MOBILE + ')', custA.status === 201, 'code ' + codeA);
  ok('Owner B onboards SAME customer (same mobile)', custB.status === 201, 'code ' + custB.j?.data?.loginCode);

  // 4. Customer activates via owner A's code
  const act = await call('POST', '/api/auth/activate-account', null, { loginCode: codeA, password: 'Cust@1234', confirmPassword: 'Cust@1234', deviceId: `dev_${ts}` });
  let custTok = act.j?.data?.tokens?.accessToken;
  ok('Customer activates (code A)', !!custTok, `status ${act.status}`);
  // activate may already return availableTenants
  ok('Activate response lists availableTenants', Array.isArray(act.j?.data?.availableTenants) ? act.j.data.availableTenants.length >= 1 : 'WARN', `count ${act.j?.data?.availableTenants?.length ?? 'n/a'}`);

  // 5. Login by mobile+password → availableTenants should list BOTH businesses
  const login = await call('POST', '/api/auth/login', null, { mobileNumber: MOBILE, password: 'Cust@1234', deviceId: `dev_${ts}` });
  custTok = login.j?.data?.tokens?.accessToken || custTok;
  const avail = login.j?.data?.availableTenants || [];
  ok('Customer login by mobile', !!custTok, `status ${login.status}`);
  ok('Login lists BOTH tenants (A+B)', avail.length === 2, `availableTenants=${avail.length}: ${avail.map(t => t.name).join(', ')}`);
  const tenantBId = avail.find(t => t.name === 'Business B')?.id || B.tenantId;

  // 6. Current tenant (A) — what catalog does the customer see?
  const prodsInA = await call('GET', '/api/products', custTok);
  const namesA = (prodsInA.j?.data || []).map(p => p.name);
  ok('In tenant A: sees A product', namesA.includes(catA.productName), `sees: [${namesA.join(', ')}]`);
  ok('In tenant A: does NOT see B product', !namesA.includes(catB.productName), namesA.includes(catB.productName) ? '❗ LEAK: sees B product' : 'isolated');

  // 7. Place an order in tenant A
  const orderA = await call('POST', '/api/orders/place', custTok, { items: [{ variantId: catA.variantId, quantity: 1 }] });
  ok('Customer places order in tenant A', orderA.status === 201 || orderA.ok, `order ${orderA.j?.data?.orderNumber}`);

  // 8. Switch to tenant B
  const sw = await call('POST', '/api/auth/switch-tenant', custTok, { tenantId: tenantBId });
  const tokB = sw.j?.data?.tokens?.accessToken;
  ok('Switch-tenant to B', !!tokB, `status ${sw.status}`);

  // 9. In tenant B: sees B catalog, NOT A; orders isolated
  if (tokB) {
    const prodsInB = await call('GET', '/api/products', tokB);
    const namesB = (prodsInB.j?.data || []).map(p => p.name);
    ok('In tenant B: sees B product', namesB.includes(catB.productName), `sees: [${namesB.join(', ')}]`);
    ok('In tenant B: does NOT see A product', !namesB.includes(catA.productName), namesB.includes(catA.productName) ? '❗ LEAK: sees A product' : 'isolated');
    const ordersInB = await call('GET', '/api/orders', tokB);
    const orderNumsB = (ordersInB.j?.data || []).map(o => o.orderNumber);
    ok('In tenant B: A-order NOT visible (order isolation)', !orderNumsB.includes(orderA.j?.data?.orderNumber), `B orders: ${orderNumsB.length}`);
  }

  console.log('\n══════ MULTI-TENANT CUSTOMER ══════');
  log.forEach(l => console.log('  ' + l));
  console.log('═══════════════════════════════════\n');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
