// Delete test artifacts (users with known test email prefixes + their tenants
// and that tenant's products/categories/orders). Scoped to test prefixes so it
// can't touch real data. Run: node cleanup-loadtest.js
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const testEmail = /^(loadtest\.|lt\.|vp\.|rp\.|qa\.)/;
  const users = db.collection('users');

  const testUsers = await users.find({ email: testEmail }).project({ _id: 1, tenantId: 1 }).toArray();
  const tenantIds = [...new Set(testUsers.map((u) => u.tenantId).filter(Boolean).map(String))].map((id) => new mongoose.Types.ObjectId(id));
  const inTenants = { tenantId: { $in: tenantIds } };

  const delUsers = await users.deleteMany({ email: testEmail });
  const delTenants = await db.collection('tenants').deleteMany({ _id: { $in: tenantIds } });
  const delProducts = await db.collection('products').deleteMany(inTenants);
  const delCategories = await db.collection('categories').deleteMany(inTenants);
  const delOrders = await db.collection('orders').deleteMany(inTenants);

  console.log(`Users: ${delUsers.deletedCount} | Tenants: ${delTenants.deletedCount} | Products: ${delProducts.deletedCount} | Categories: ${delCategories.deletedCount} | Orders: ${delOrders.deletedCount}`);

  await mongoose.disconnect();
})().catch((e) => { console.error('cleanup error:', e.message); process.exit(1); });
