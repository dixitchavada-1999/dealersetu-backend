/*
 * Comprehensive check of EVERY API endpoint the mobile app (dealersetu-app/lib/api.ts) calls.
 * Logs in as owner + super-admin + (activated) customer and exercises each module.
 * Reports PASS / WARN / FAIL per endpoint. Run with backend up on :3000.
 */
const BASE = 'http://localhost:3000';
const ts = Date.now();
let pass = 0, warn = 0, fail = 0;
const lines = [];
function rec(name, ok, detail) {
  if (ok === 'WARN') { warn++; lines.push(`  ⚠️  ${name}${detail ? ' — ' + detail : ''}`); }
  else if (ok) { pass++; lines.push(`  ✅ ${name}`); }
  else { fail++; lines.push(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
async function call(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, ok: r.ok, j };
}
// expect: pass if status is in okSet
function t(name, res, okStatuses = [200, 201]) {
  rec(name, okStatuses.includes(res.status), `status ${res.status}${res.j?.message ? ' — ' + String(res.j.message).slice(0, 60) : ''}`);
  return res;
}

(async () => {
  // ===== tokens =====
  const owner = (await call('POST', '/api/auth/login', null, { email: 'admin@gmail.com', password: 'Admin@123' })).j?.data?.tokens?.accessToken;
  const sa = (await call('POST', '/api/auth/login', null, { email: 'superadmin@platform.com', password: 'SuperAdmin123!' })).j?.data?.tokens?.accessToken;
  console.log(`\nTokens: owner=${owner ? 'OK' : 'FAIL'} superadmin=${sa ? 'OK' : 'FAIL'}\n`);
  if (!owner) { console.log('FATAL: owner login failed'); process.exit(1); }

  // ===== AUTH =====
  console.log('▶ Auth');
  t('GET update-profile guard (POST)', await call('POST', '/api/auth/update-profile', owner, { firstName: 'Admin' }));

  // ===== CATEGORIES (full CRUD) =====
  console.log('\n▶ Categories');
  t('categories.getAll', await call('GET', '/api/categories', owner));
  const cat = t('categories.create', await call('POST', '/api/categories', owner, { name: `Cat ${ts}`, description: 'x', variantAttributes: [{ name: 'Size', values: ['M', 'L'] }] }));
  const catId = cat.j?.data?._id;
  t('categories.getById', await call('GET', `/api/categories/${catId}`, owner));
  t('categories.update', await call('PUT', `/api/categories/${catId}`, owner, { description: 'updated' }));

  // ===== PRODUCTS =====
  console.log('\n▶ Products');
  t('products.getAll', await call('GET', '/api/products', owner));
  const prod = t('products.create', await call('POST', '/api/products', owner, { name: `Prod ${ts}`, categoryId: catId, productCode: `PC${ts}`, taxPercentage: 5, unit: 'Piece', hasVariants: true, variantAttributes: [{ name: 'Size', values: ['M'] }] }));
  const prodId = prod.j?.data?._id;
  t('products.getById', await call('GET', `/api/products/${prodId}`, owner));
  t('products.update', await call('PUT', `/api/products/${prodId}`, owner, { brand: 'B' }));

  // ===== VARIANTS =====
  console.log('\n▶ Variants');
  t('variants.getAll', await call('GET', `/api/variants?productId=${prodId}`, owner));
  const variant = t('variants.create', await call('POST', '/api/variants', owner, { productId: prodId, sku: `SKU${ts}`, price: 500, costPrice: 300, taxPercentage: 5, stockQty: 50, unit: 'Piece', attributes: { Size: 'M' }, isActive: true }));
  const variantId = variant.j?.data?._id;
  t('variants.getById', await call('GET', `/api/variants/${variantId}`, owner));
  t('variants.update', await call('PUT', `/api/variants/${variantId}`, owner, { price: 550 }));
  t('variants.updateStock', await call('PATCH', `/api/variants/${variantId}/stock`, owner, { stockQty: 100 }));

  // ===== ORDERS (full lifecycle) =====
  console.log('\n▶ Orders');
  t('orders.getAll', await call('GET', '/api/orders', owner));
  const place = t('orders.place', await call('POST', '/api/orders/place', owner, { items: [{ variantId, quantity: 5 }], notes: 'test' }));
  const orderId = place.j?.data?._id;
  t('orders.getById', await call('GET', `/api/orders/${orderId}`, owner));
  t('orders.edit', await call('PUT', `/api/orders/${orderId}/edit`, owner, { items: [{ variantId, quantity: 3 }], courierCharge: 20 }));
  t('orders.update (approve)', await call('PUT', `/api/orders/${orderId}`, owner, { orderStatus: 'Approved' }));
  t('orders.delete (cancel)', await call('DELETE', `/api/orders/${orderId}`, owner));

  // ===== DASHBOARD =====
  console.log('\n▶ Dashboard');
  t('dashboard.getStats', await call('GET', '/api/dashboard', owner));

  // ===== TEAM / USERS =====
  console.log('\n▶ Team');
  t('team.balances', await call('GET', '/api/team/balances', owner));
  t('team.getMembers', await call('GET', '/api/team', owner));
  const member = t('team.create', await call('POST', '/api/team', owner, { firstName: 'Cust', lastName: 'A', email: `cust${ts}@x.test`, mobileNumber: `91${String(ts).slice(-8)}`, shopName: 'S' }));
  const memberId = member.j?.data?.id;
  let loginCode = member.j?.data?.loginCode;
  t('team.update', await call('PUT', `/api/team/${memberId}`, owner, { shopName: 'S2', discount: 5 }));
  t('team.lockDevice', await call('PUT', `/api/team/${memberId}/lock-device`, owner));
  const rd = t('team.resetDevice', await call('PUT', `/api/team/${memberId}/reset-device`, owner));
  if (rd.j?.data?.loginCode) loginCode = rd.j.data.loginCode; // resetDevice regenerates the code
  t('team.getTenant', await call('GET', '/api/team/tenant', owner));
  t('team.updateTenant', await call('PUT', '/api/team/tenant', owner, { lowStockThreshold: 8 }));
  t('team.dispatch.getAll', await call('GET', '/api/team/dispatch', owner));
  t('team.production.getAll', await call('GET', '/api/team/production', owner));
  t('team.marketing.getAll', await call('GET', '/api/team/marketing', owner));

  // ===== NOTIFICATIONS =====
  console.log('\n▶ Notifications');
  t('notifications.getAll', await call('GET', '/api/notifications', owner));
  t('notifications.unreadCount', await call('GET', '/api/notifications/unread-count', owner));

  // ===== FEEDBACK =====
  console.log('\n▶ Feedback');
  t('feedback.all', await call('GET', '/api/feedback/all', owner));
  t('feedback.my', await call('GET', '/api/feedback/my', owner));

  // ===== BANNERS =====
  console.log('\n▶ Banners');
  t('banners.getAll', await call('GET', '/api/banners', owner));
  const banner = t('banners.create', await call('POST', '/api/banners', owner, { title: `B${ts}`, imageUrl: 'https://x/y.png', isActive: true }));
  const bannerId = banner.j?.data?._id;
  if (bannerId) { t('banners.update', await call('PUT', `/api/banners/${bannerId}`, owner, { title: 'B2' })); t('banners.delete', await call('DELETE', `/api/banners/${bannerId}`, owner)); }

  // ===== VISITS =====
  console.log('\n▶ Visits');
  t('visits.getAll', await call('GET', '/api/visits', owner));
  t('visits.stats', await call('GET', '/api/visits/stats', owner));
  const visit = t('visits.create', await call('POST', '/api/visits', owner, { customerName: `V${ts}`, customerPhone: '9999999999' }));
  const visitId = visit.j?.data?._id;
  if (visitId) t('visits.getById', await call('GET', `/api/visits/${visitId}`, owner));

  // ===== ROLES =====
  console.log('\n▶ Roles');
  t('roles.catalog', await call('GET', '/api/roles/catalog', owner));
  t('roles.getAll', await call('GET', '/api/roles', owner));

  // ===== MODULES =====
  console.log('\n▶ Modules');
  t('modules.getAll', await call('GET', '/api/modules', owner));

  // ===== CUSTOMER flow (activate + customer-only endpoints) =====
  console.log('\n▶ Customer flow');
  let custTok = null;
  if (loginCode) {
    const act = await call('POST', '/api/auth/activate-account', null, { loginCode, password: 'Cust@1234', confirmPassword: 'Cust@1234', deviceId: `dev${ts}` });
    custTok = act.j?.data?.tokens?.accessToken;
    rec('auth.activate-account', !!custTok, `status ${act.status}`);
  }
  if (custTok) {
    t('products.my-purchased (customer)', await call('GET', '/api/products/my-purchased', custTok));
    const cplace = t('orders.place (customer)', await call('POST', '/api/orders/place', custTok, { items: [{ variantId, quantity: 2 }] }));
    const cOrderId = cplace.j?.data?._id;
    if (cOrderId) {
      // approve+dispatch as owner, then customer confirm-delivery
      await call('PUT', `/api/orders/${cOrderId}`, owner, { orderStatus: 'Approved' });
      await call('PUT', `/api/orders/${cOrderId}`, owner, { orderStatus: 'Dispatched' });
      t('orders.confirm-delivery (customer)', await call('PUT', `/api/orders/${cOrderId}/confirm-delivery`, custTok));
      t('feedback.create (customer)', await call('POST', '/api/feedback', custTok, { type: 'order', orderId: cOrderId, rating: 5, comment: 'good' }));
    }
  }

  // ===== SUPER ADMIN =====
  console.log('\n▶ Super Admin');
  if (sa) {
    const tn = t('super.tenants', await call('GET', '/api/super-admin/tenants?page=1&limit=5', sa));
    const tid = tn.j?.data?.[0]?._id || tn.j?.data?.tenants?.[0]?._id;
    t('super.dashboard', await call('GET', '/api/super-admin/dashboard', sa));
    t('super.activity-logs', await call('GET', '/api/super-admin/activity-logs?page=1', sa));
    if (tid) {
      t('super.tenantDetail', await call('GET', `/api/super-admin/tenants/${tid}`, sa));
      t('super.tenantUsers', await call('GET', `/api/super-admin/tenants/${tid}/users`, sa));
      t('super.tenantOrders', await call('GET', `/api/super-admin/tenants/${tid}/orders`, sa));
    }
  }

  // ===== cleanup created entities =====
  await call('DELETE', `/api/variants/${variantId}`, owner);
  await call('DELETE', `/api/products/${prodId}`, owner);
  await call('DELETE', `/api/categories/${catId}`, owner);
  await call('DELETE', `/api/team/${memberId}`, owner);

  console.log('\n══════════════════════════════════════');
  lines.forEach(l => console.log(l));
  console.log('──────────────────────────────────────');
  console.log(`  ✅ PASS ${pass}   ⚠️ WARN ${warn}   ❌ FAIL ${fail}`);
  console.log('══════════════════════════════════════\n');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
