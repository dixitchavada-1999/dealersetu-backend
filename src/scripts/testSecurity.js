/* Security regression test: login works, injection blocked, no secret leak, JWT pin, forgot-password. */
const BASE = 'http://localhost:3000';
async function post(p, b) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, j };
}
(async () => {
  // 1. Normal login
  const ok = await post('/api/auth/login', { email: 'admin@gmail.com', password: 'Admin@123' });
  const tok = ok.j?.data?.tokens?.accessToken;
  console.log('1. Normal login:', tok ? '✅ 200' : '❌ ' + ok.status);

  // 1b. No secret leak in login response
  const u = ok.j?.data?.user || {};
  const leak = ['password', 'refreshToken', 'resetPasswordToken'].filter((k) => k in u);
  console.log('1b. No secret in login response:', leak.length === 0 ? '✅' : '❌ leaked ' + leak.join(','));

  // 2. NoSQL operator injection on userName
  const inj = await post('/api/auth/login', { userName: { $gt: '' }, password: 'x' });
  console.log('2. NoSQL $gt injection blocked:', inj.status !== 200 ? '✅ ' + inj.status : '❌ BYPASS!');

  // 2b. NoSQL injection on password
  const inj2 = await post('/api/auth/login', { email: 'admin@gmail.com', password: { $ne: 'x' } });
  console.log('2b. NoSQL $ne password blocked:', inj2.status !== 200 ? '✅ ' + inj2.status : '❌ BYPASS!');

  // 3. Valid token -> protected route (JWT algorithm pin still accepts HS256)
  const me = await fetch(BASE + '/api/orders', { headers: { Authorization: 'Bearer ' + tok } });
  console.log('3. Valid token -> protected route:', me.status === 200 ? '✅' : '❌ ' + me.status);

  // 3b. Tampered token rejected
  const bad = await fetch(BASE + '/api/orders', { headers: { Authorization: 'Bearer ' + tok + 'x' } });
  console.log('3b. Tampered token rejected:', bad.status === 401 ? '✅' : '❌ ' + bad.status);

  // 4. Forgot-password still works (crypto OTP)
  const fp = await post('/api/auth/forgot-password', { email: 'dixit.chavada1999@gmail.com' });
  console.log('4. Forgot-password (crypto OTP):', fp.status === 200 ? '✅' : '❌ ' + fp.status);
})().catch((e) => { console.error('CRASH:', e.message); process.exit(1); });
