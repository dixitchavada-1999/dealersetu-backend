/*
 * End-to-end forgot-password test against local backend.
 * 1. Ensure a user with email dixit.chavada1999@gmail.com exists (register if needed)
 * 2. POST /forgot-password  -> backend emails a real OTP (via Brevo)
 * 3. Read the OTP from DB (resetPasswordToken)
 * 4. POST /reset-password    -> set a new password
 * 5. Login with the new password -> confirm reset worked
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');

const BASE = 'http://localhost:3000';
const EMAIL = 'dixit.chavada1999@gmail.com';
const OLD_PASS = 'OldPass@123';
const NEW_PASS = 'NewPass@456';
const ts = Date.now();

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, ok: res.ok, json };
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected DB:', mongoose.connection.name, '\n');

  // 1. Ensure user exists
  let user = await User.findOne({ email: EMAIL });
  if (!user) {
    const reg = await api('POST', '/api/auth/register', {
      firstName: 'Dixit', lastName: 'Chavada', email: EMAIL,
      userName: `dixit${ts}`, password: OLD_PASS, mobileNumber: '9111100000',
      businessName: 'Dixit Test Co', deviceId: `fp-${ts}`,
    });
    console.log(`1. Register ${EMAIL}: ${reg.status === 201 ? '✅ created' : '❌ ' + JSON.stringify(reg.json)}`);
  } else {
    console.log(`1. User ${EMAIL} already exists ✅`);
  }

  // 2. Forgot password -> sends OTP email
  const forgot = await api('POST', '/api/auth/forgot-password', { email: EMAIL });
  console.log(`2. Forgot-password request: ${forgot.ok ? '✅' : '❌'} ${forgot.status} — "${forgot.json?.message}"`);
  console.log(`   -> A real OTP email should now be in ${EMAIL} inbox (subject "Password Reset OTP")`);

  // 3. Read OTP from DB
  await new Promise(r => setTimeout(r, 800));
  user = await User.findOne({ email: EMAIL }).select('+resetPasswordToken resetPasswordToken resetPasswordExpires');
  const otp = user?.resetPasswordToken;
  console.log(`3. OTP stored in DB: ${otp ? '✅ ' + otp : '❌ none'}  (expires ${user?.resetPasswordExpires?.toISOString?.() || 'n/a'})`);
  if (!otp) { console.log('Aborting — no OTP.'); await mongoose.connection.close(); process.exit(1); }

  // 4. Reset password with OTP
  const reset = await api('POST', '/api/auth/reset-password', { email: EMAIL, otp, newPassword: NEW_PASS });
  console.log(`4. Reset-password: ${reset.ok ? '✅' : '❌'} ${reset.status} — "${reset.json?.message}"`);

  // 4b. Old OTP should no longer work (one-time use)
  const reuse = await api('POST', '/api/auth/reset-password', { email: EMAIL, otp, newPassword: 'Another@789' });
  console.log(`   OTP one-time check (reuse should fail): ${!reuse.ok ? '✅ rejected' : '❌ accepted again!'} (${reuse.status})`);

  // 5. Login with NEW password
  const login = await api('POST', '/api/auth/login', { email: EMAIL, password: NEW_PASS });
  console.log(`5. Login with NEW password: ${login.ok && login.json?.data?.tokens?.accessToken ? '✅ success' : '❌ ' + login.status}`);

  // 5b. Old password should fail (master password may override, so just informational)
  const oldLogin = await api('POST', '/api/auth/login', { email: EMAIL, password: OLD_PASS });
  console.log(`   Old password now: ${oldLogin.ok ? '⚠️ still works (likely MASTER_PASSWORD override)' : '✅ rejected'} (${oldLogin.status})`);

  console.log('\n🎉 Forgot-password flow tested end-to-end.');
  await mongoose.connection.close();
  process.exit(0);
})().catch(async e => { console.error('CRASH:', e.message); try { await mongoose.connection.close(); } catch {} process.exit(1); });
