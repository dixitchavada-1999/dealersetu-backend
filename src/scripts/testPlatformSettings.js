/* Test platform-settings CRUD + that email logo follows it. */
const BASE = 'http://localhost:3000';
let token = null;
async function api(method, path, body, noAuth) {
  const headers = { 'Content-Type': 'application/json' };
  if (token && !noAuth) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, json };
}
const log = (n, ok, x = '') => console.log(`${ok ? '✅' : '❌'} ${n}${x ? ' — ' + x : ''}`);

(async () => {
  // Public GET
  const pub = await api('GET', '/api/platform-settings', null, true);
  log('GET settings (public)', pub.ok, `brand ${pub.json?.data?.brandName}`);

  token = (await api('POST', '/api/auth/login', { email: 'superadmin@platform.com', password: 'SuperAdmin123!' })).json?.data?.tokens?.accessToken;
  log('super-admin login', !!token);

  // Non-super-admin blocked on PUT
  const ownerTok = (await api('POST', '/api/auth/login', { email: 'admin@gmail.com', password: 'Admin@123' })).json?.data?.tokens?.accessToken;
  const blocked = await fetch(`${BASE}/api/platform-settings`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerTok}` }, body: JSON.stringify({ logoUrl: 'x' }) });
  log('owner blocked on PUT', blocked.status === 403, `status ${blocked.status}`);

  // Update logo
  const TEST_LOGO = 'https://res.cloudinary.com/dpy58lnw6/image/upload/e_background_removal/e_trim/c_pad,w_480,h_140/v1781807258/dealersetu/branding/logo-email.png';
  const upd = await api('PUT', '/api/platform-settings', { logoUrl: TEST_LOGO, brandName: 'DealerSetu', brandColor: '#0F52BA' });
  log('PUT update logo (super-admin)', upd.ok && upd.json?.data?.logoUrl === TEST_LOGO);

  // Email preview should now use the platform logo
  const prev = await api('POST', '/api/super-admin/email-templates/preview', { subject: 's', heading: 'h', bodyTop: 'b', logoUrl: 'https://other.example/x.png', footerText: 'f' });
  log('email preview uses PLATFORM logo (override)', prev.json?.data?.html?.includes(TEST_LOGO) && !prev.json?.data?.html?.includes('other.example'));

  console.log('\n🎉 Platform settings tested.');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
