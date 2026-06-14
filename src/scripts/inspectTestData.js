/**
 * Inspect test data — list tenants and any USER customers grouped by mobile.
 * Read-only. Used for end-to-end suspension flow test.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('\n=== TENANTS ===');
    const tenants = await Tenant.find({}).select('_id name isActive');
    tenants.forEach(t => {
        console.log(`  ${t._id} | ${t.name} | active=${t.isActive}`);
    });

    console.log('\n=== USER (customer) accounts grouped by mobile ===');
    const users = await User.find({ role: 'USER' }).select('_id tenantId mobileNumber email firstName isPasswordSet isActive').lean();
    const byMobile = {};
    for (const u of users) {
        const key = u.mobileNumber || '(no mobile)';
        if (!byMobile[key]) byMobile[key] = [];
        byMobile[key].push(u);
    }
    for (const [mobile, list] of Object.entries(byMobile)) {
        if (list.length > 1) {
            console.log(`\n  📱 ${mobile} — appears in ${list.length} tenants:`);
            for (const u of list) {
                const tn = tenants.find(t => t._id.toString() === u.tenantId?.toString());
                console.log(`     ${u._id} | ${tn?.name || 'unknown'} | ${u.email || '-'} | ${u.firstName || '-'} | activated=${u.isPasswordSet}`);
            }
        }
    }

    console.log('\n=== Counts ===');
    console.log(`  Total tenants: ${tenants.length}`);
    console.log(`  Active tenants: ${tenants.filter(t => t.isActive).length}`);
    console.log(`  Total USER accounts: ${users.length}`);
    console.log(`  Mobile numbers spanning multiple tenants: ${Object.values(byMobile).filter(v => v.length > 1).length}`);

    await mongoose.disconnect();
})();
