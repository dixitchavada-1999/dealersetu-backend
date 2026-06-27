/*
 * SMTP / welcome-email diagnostic.
 *
 * Sends the real `customer_welcome` template through the configured SMTP
 * (Brevo on production) and prints the full transporter response or error,
 * so you can see exactly why customer emails do/don't arrive.
 *
 * Run where the SMTP_* env vars are set (Railway "Console" tab, or locally
 * after filling SMTP_* in .env):
 *
 *   node src/scripts/testEmail.js you@example.com
 */
require('dotenv').config();
const nodemailer = require('nodemailer');
const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');

const to = process.argv[2];

const mask = (v) => (v ? `${String(v).slice(0, 4)}…${String(v).slice(-4)}` : '(empty)');

(async () => {
  console.log('── SMTP config ──');
  console.log('SMTP_HOST :', process.env.SMTP_HOST || '(empty)');
  console.log('SMTP_PORT :', process.env.SMTP_PORT || '(empty)');
  console.log('SMTP_USER :', process.env.SMTP_USER || '(empty)');
  console.log('SMTP_PASS :', mask(process.env.SMTP_PASS));
  console.log('SMTP_FROM :', process.env.SMTP_FROM || '(empty)');
  console.log('');

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error('❌ SMTP env vars are missing in this environment. Run this where they are set.');
    process.exit(1);
  }

  // 1. Verify the connection/credentials independently of any recipient.
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  try {
    await transporter.verify();
    console.log('✅ transporter.verify() OK — SMTP connection + auth succeeded');
  } catch (err) {
    console.error('❌ transporter.verify() FAILED:', err.message);
    console.error('   Full error:', err);
    process.exit(1);
  }

  if (!to) {
    console.log('\nℹ️  No recipient given. Pass one to send a real test:');
    console.log('   node src/scripts/testEmail.js you@example.com');
    process.exit(0);
  }

  // 2. Send the actual customer_welcome template.
  try {
    const info = await sendTemplatedEmail('customer_welcome', to, {
      name: 'Test Customer',
      loginCode: 'TEST1234',
      shopName: process.env.SMTP_FROM ? 'DealerSetu' : 'DealerSetu',
    });
    console.log(`\n✅ Sent customer_welcome to ${to}`);
    console.log('   messageId:', info?.messageId);
    console.log('   response :', info?.response);
    console.log('   accepted :', info?.accepted);
    console.log('   rejected :', info?.rejected);
    console.log('\n👉 If accepted is non-empty but the mail never arrives, check spam and the');
    console.log('   Brevo sender verification for the SMTP_FROM address.');
  } catch (err) {
    console.error(`\n❌ Failed to send to ${to}:`, err.message);
    console.error('   Full error:', err);
    process.exit(1);
  }
  process.exit(0);
})();
