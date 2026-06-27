// Delete load-test artifacts created this session (users with email prefix
// `loadtest.` or `lt.`, plus their tenants). Scoped + guarded so it can't touch
// real data. Run: node cleanup-loadtest.js
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const testEmail = /^(loadtest\.|lt\.)/;
  const users = db.collection('users');
  const tenants = db.collection('tenants');

  const testUsers = await users.find({ email: testEmail }).project({ _id: 1, tenantId: 1, email: 1 }).toArray();
  const tenantIds = [...new Set(testUsers.map((u) => u.tenantId).filter(Boolean).map(String))].map((id) => new mongoose.Types.ObjectId(id));

  const delUsers = await users.deleteMany({ email: testEmail });
  // Only delete tenants referenced by the test users AND whose name looks like a test tenant.
  const delTenants = await tenants.deleteMany({ _id: { $in: tenantIds }, name: /^LT/ });

  console.log(`Deleted users:   ${delUsers.deletedCount}`);
  console.log(`Deleted tenants: ${delTenants.deletedCount} (of ${tenantIds.length} referenced)`);

  await mongoose.disconnect();
})().catch((e) => { console.error('cleanup error:', e.message); process.exit(1); });
