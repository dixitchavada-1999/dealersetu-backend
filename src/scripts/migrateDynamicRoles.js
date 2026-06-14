/**
 * Migrate to the global dynamic-role model:
 *  1. Seed global Dispatch/Production/Marketing roles (tenantId: null).
 *  2. Reassign any staff pointing at old per-tenant copies → global role (by slug).
 *  3. Delete the old per-tenant copies.
 *  4. Reset every tenant's enabledRoles to [] (dynamic roles OFF by default).
 *
 * Usage: node src/scripts/migrateDynamicRoles.js
 * Idempotent.
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const Role = require('../models/roleModel');
    const User = require('../models/userModel');
    const Tenant = require('../models/tenantModel');
    const { seedDynamicRoles, DYNAMIC_SLUGS } = require('../utils/dynamicRoles');

    // 1) Seed global catalog
    const seeded = await seedDynamicRoles();
    console.log('Global dynamic roles:', seeded.map(s => `${s.slug}${s.created ? '(created)' : '(exists)'}`).join(', '));

    // Map slug → global role id
    const globals = await Role.find({ tenantId: null, slug: { $in: DYNAMIC_SLUGS } }).select('_id slug').lean();
    const globalBySlug = Object.fromEntries(globals.map(r => [r.slug, r._id]));

    // 2+3) Reassign staff off per-tenant copies, then delete the copies
    const copies = await Role.find({ tenantId: { $ne: null }, slug: { $in: DYNAMIC_SLUGS } }).select('_id slug tenantId').lean();
    let reassigned = 0;
    for (const copy of copies) {
        const target = globalBySlug[copy.slug];
        const r = await User.updateMany({ roleId: copy._id }, { $set: { roleId: target } });
        reassigned += r.modifiedCount || 0;
    }
    const del = await Role.deleteMany({ tenantId: { $ne: null }, slug: { $in: DYNAMIC_SLUGS } });
    console.log(`Reassigned ${reassigned} staff user(s); deleted ${del.deletedCount} per-tenant copy/copies.`);

    // 4) Reset enabledRoles (dynamic roles OFF by default)
    const t = await Tenant.updateMany({}, { $set: { enabledRoles: [] } });
    console.log(`Reset enabledRoles on ${t.modifiedCount} tenant(s) → [] (all dynamic roles inactive).`);

    await mongoose.disconnect();
    console.log('\nDone.');
})().catch(e => { console.error(e); process.exit(1); });
