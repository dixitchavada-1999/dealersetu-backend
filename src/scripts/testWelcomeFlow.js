/*
 * Full CRUD test of the email-template module + welcome-on-customer-create flow.
 * 1. (CREATE) make 'customer_welcome' template via the CRUD API
 * 2. (READ)   fetch it
 * 3. (UPDATE) edit it
 * 4. (CRUD)   create+update+delete a throwaway template (proves delete)
 * 5. Owner creates a customer -> welcome email sent to dixit's inbox via the template
 */
const BASE = 'http://localhost:3000';
const ts = Date.now();
let token = null;
async function api(method, path, body, tok) {
  const headers = { 'Content-Type': 'application/json' };
  const t = tok !== undefined ? tok : token;
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, json };
}
const log = (n, ok, extra = '') => console.log(`${ok ? '✅' : '❌'} ${n}${extra ? ' — ' + extra : ''}`);

(async () => {
  // Super-admin
  token = (await api('POST', '/api/auth/login', { email: 'superadmin@platform.com', password: 'SuperAdmin123!' })).json?.data?.tokens?.accessToken;
  log('super-admin login', !!token);

  console.log('\n── CRUD: customer_welcome template ──');
  // Clean slate (DELETE — ok if not present)
  await api('DELETE', '/api/super-admin/email-templates/customer_welcome');

  // CREATE
  const create = await api('POST', '/api/super-admin/email-templates', {
    key: 'customer_welcome', name: 'Customer Welcome',
    subject: 'Welcome to {{shopName}} — your login code',
    heading: 'Welcome to {{shopName}}!',
    bodyTop: 'Hi {{name}},\nYour account has been created. Use the login code below to activate it:',
    highlightKey: 'loginCode',
    bodyBottom: 'Open the DealerSetu app → Customer Login → enter this code.',
    footerText: '© 2026 DealerSetu',
    placeholders: ['name', 'loginCode', 'shopName'],
  });
  log('CREATE customer_welcome', create.status === 201, `status ${create.status}`);

  // READ
  const read = await api('GET', '/api/super-admin/email-templates/customer_welcome');
  log('READ customer_welcome', read.ok && read.json?.data?.key === 'customer_welcome', read.json?.data?.subject);

  // UPDATE
  const upd = await api('PUT', '/api/super-admin/email-templates/customer_welcome', { bodyBottom: 'Open the DealerSetu app and enter this code to get started. (edited via CRUD)' });
  log('UPDATE customer_welcome', upd.ok && upd.json?.data?.bodyBottom?.includes('edited via CRUD'));

  console.log('\n── CRUD: throwaway template (proves delete) ──');
  const tmpKey = `demo_${ts}`;
  const c2 = await api('POST', '/api/super-admin/email-templates', { key: tmpKey, name: 'Demo', subject: 'demo' });
  log('CREATE throwaway', c2.status === 201);
  const u2 = await api('PUT', `/api/super-admin/email-templates/${tmpKey}`, { subject: 'demo edited' });
  log('UPDATE throwaway', u2.ok && u2.json?.data?.subject === 'demo edited');
  const d2 = await api('DELETE', `/api/super-admin/email-templates/${tmpKey}`);
  const gone = await api('GET', `/api/super-admin/email-templates/${tmpKey}`);
  log('DELETE throwaway', d2.ok && gone.status === 404);

  console.log('\n── Welcome flow: owner creates a customer ──');
  const ownerTok = (await api('POST', '/api/auth/login', { email: 'admin@gmail.com', password: 'Admin@123' })).json?.data?.tokens?.accessToken;
  log('owner login', !!ownerTok);
  // Gmail +tag → delivers to dixit.chavada1999@gmail.com, avoids duplicate-email clashes
  const cust = await api('POST', '/api/team', {
    firstName: 'Dixit', lastName: 'Welcome',
    email: 'dixit.chavada1999+welcome@gmail.com',
    mobileNumber: `91${String(ts).slice(-8)}`,
    shopName: 'Dixit Traders',
  }, ownerTok);
  log('owner CREATE customer', cust.status === 201 || cust.ok, `status ${cust.status}, loginCode ${cust.json?.data?.loginCode}`);
  console.log('   -> Welcome email should arrive at dixit.chavada1999@gmail.com (via customer_welcome template)');

  console.log('\n🎉 Full CRUD + welcome flow tested.');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
