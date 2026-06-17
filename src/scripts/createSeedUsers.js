/*
 * Create two login users:
 *   1. Super Admin — superadmin@platform.com / SuperAdmin123!
 *   2. Admin (tenant OWNER) — admin@gmail.com / Admin@123
 *
 * Idempotent: skips a user that already exists.
 * Run with backend deps installed: node src/scripts/createSeedUsers.js
 * Requires system roles seeded first (node src/scripts/seedSystemRoles.js).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const Role = require('../models/roleModel');
const { ensureTenantBaselineRoles } = require('../utils/dynamicRoles');

async function run() {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected to MongoDB:', mongoose.connection.name);

  // ── 1. Super Admin ──────────────────────────────
  const superEmail = 'superadmin@platform.com';
  let superUser = await User.findOne({ email: superEmail });
  if (superUser) {
    console.log(`ℹ️  Super Admin already exists: ${superEmail} (id ${superUser._id})`);
  } else {
    const superRole = await Role.findOne({ slug: 'super-admin' });
    superUser = await User.create({
      firstName: 'Super', lastName: 'Admin', name: 'Super Admin',
      email: superEmail, userName: 'superadmin',
      password: 'SuperAdmin123!',
      role: 'SUPER_ADMIN',
      roleId: superRole?._id || undefined,
      isActive: true,
    });
    console.log(`✅ Super Admin created: ${superEmail} / SuperAdmin123!  (id ${superUser._id})`);
  }

  // ── 2. Admin (tenant OWNER) ─────────────────────
  const adminEmail = 'admin@gmail.com';
  let adminUser = await User.findOne({ email: adminEmail });
  if (adminUser) {
    console.log(`ℹ️  Admin already exists: ${adminEmail} (id ${adminUser._id})`);
  } else {
    const ownerRole = await Role.findOne({ slug: 'owner' });
    if (!ownerRole) {
      console.error('❌ Owner system role not found. Run: node src/scripts/seedSystemRoles.js');
      process.exit(1);
    }
    const tenant = await Tenant.create({ name: 'Admin Business', email: adminEmail });
    adminUser = await User.create({
      tenantId: tenant._id,
      firstName: 'Admin', lastName: 'User', name: 'Admin User',
      email: adminEmail, userName: 'admin',
      mobileNumber: '9000000000',
      password: 'Admin@123',
      role: 'OWNER',
      roleId: ownerRole._id,
      isActive: true,
    });
    await ensureTenantBaselineRoles(tenant._id, adminUser._id);
    console.log(`✅ Admin (OWNER) created: ${adminEmail} / Admin@123  (id ${adminUser._id}, tenant ${tenant._id})`);
  }

  await mongoose.connection.close();
  console.log('\n✅ Done.');
  process.exit(0);
}

run().catch(async (e) => {
  console.error('❌ Failed:', e.message);
  try { await mongoose.connection.close(); } catch {}
  process.exit(1);
});
