/* Test the email-template super-admin API + dynamic send. */
const BASE = 'http://localhost:3000';
let token = null;
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, json };
}
(async () => {
  // 1. Super-admin login
  const login = await api('POST', '/api/auth/login', { email: 'superadmin@platform.com', password: 'SuperAdmin123!' });
  token = login.json?.data?.tokens?.accessToken;
  console.log(`1. Super-admin login: ${token ? '✅' : '❌ ' + login.status}`);

  // 2. List templates
  const list = await api('GET', '/api/super-admin/email-templates');
  console.log(`2. List templates: ${list.ok ? '✅' : '❌'} — ${list.json?.data?.map(t => t.key).join(', ')}`);

  // 3. Non-super-admin blocked? (login as admin owner)
  const adminLogin = await api('POST', '/api/auth/login', { email: 'admin@gmail.com', password: 'Admin@123' });
  const adminTok = adminLogin.json?.data?.tokens?.accessToken;
  const blocked = await fetch(`${BASE}/api/super-admin/email-templates`, { headers: { Authorization: `Bearer ${adminTok}` } });
  console.log(`3. Non-super-admin blocked: ${blocked.status === 403 ? '✅ 403' : '❌ ' + blocked.status}`);

  // 4. Preview (render without saving)
  const preview = await api('POST', '/api/super-admin/email-templates/preview', {
    subject: 'Test {{name}}', heading: 'Hi', bodyTop: 'Code for {{name}}:', highlightKey: 'otp',
    bodyBottom: 'Expires soon.', footerText: '© 2026', brandColor: '#0F52BA',
  });
  console.log(`4. Preview render: ${preview.ok && preview.json?.data?.html?.includes('475634') ? '✅ (sample OTP injected)' : '❌'}`);

  // 5. Edit password_reset template
  const edit = await api('PUT', '/api/super-admin/email-templates/password_reset', {
    bodyBottom: 'This code expires in 15 minutes.\nEDITED BY SUPER ADMIN TEST — ignore if not you.',
  });
  console.log(`5. Update password_reset: ${edit.ok ? '✅' : '❌ ' + JSON.stringify(edit.json)}`);

  // 6. Forgot-password now uses the EDITED template (sends real email)
  const forgot = await api('POST', '/api/auth/forgot-password', { email: 'dixit.chavada1999@gmail.com' });
  console.log(`6. Forgot-password (uses edited template): ${forgot.ok ? '✅ email sent' : '❌ ' + forgot.status}`);
  console.log('   -> Check inbox: body should now contain "EDITED BY SUPER ADMIN TEST"');

  console.log('\n🎉 Email-template system tested.');
})().catch(e => { console.error('CRASH:', e.message); process.exit(1); });
