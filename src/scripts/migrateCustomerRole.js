/**
 * Make Customer an owner-editable per-tenant role:
 *  1. Provision each tenant's editable Customer copy (seeded from the system template).
 *  2. Repoint existing customer users to their tenant's copy.
 *
 * The global 'customer' system role stays as the default TEMPLATE.
 * Usage: node src/scripts/migrateCustomerRole.js   (idempotent)
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const Tenant = require('../models/tenantModel');
    const User = require('../models/userModel');
    const Role = require('../models/roleModel');
    const { ensureTenantBaselineRoles } = require('../utils/dynamicRoles');

    const tenants = await Tenant.find({}).select('_id name').lean();
    let totalReassigned = 0;

    for (const t of tenants) {
        await ensureTenantBaselineRoles(t._id);
        const copy = await Role.findOne({ tenantId: t._id, slug: 'customer' }).select('_id permissions').lean();
        if (!copy) { console.log(`  ✗ ${t.name}: copy missing`); continue; }

        // Repoint this tenant's customers (any roleId that isn't already the copy).
        const r = await User.updateMany(
            { tenantId: t._id, role: { $in: ['USER', 'CUSTOMER'] }, roleId: { $ne: copy._id } },
            { $set: { roleId: copy._id } }
        );
        totalReassigned += r.modifiedCount || 0;
        console.log(`  ✓ ${t.name}: customer copy ${copy._id} (${copy.permissions.length} perms), reassigned ${r.modifiedCount || 0} customer(s)`);
    }

    console.log(`\nDone — ${tenants.length} tenant(s), ${totalReassigned} customer(s) repointed.`);
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
