/**
 * Verify User compound indexes are in place (per-tenant uniqueness).
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const indexes = await User.collection.indexes();
    console.log('\n=== User collection indexes ===');
    indexes.forEach(idx => {
        const keyStr = JSON.stringify(idx.key);
        const flags = [];
        if (idx.unique) flags.push('unique');
        if (idx.sparse) flags.push('sparse');
        if (idx.partialFilterExpression) flags.push('partial');
        console.log(`  ${idx.name.padEnd(35)} ${keyStr.padEnd(50)} ${flags.join(',')}`);
    });

    const compound = ['tenantId_1_email_1', 'tenantId_1_userName_1', 'tenantId_1_mobileNumber_1'];
    console.log('\n=== Compound index check ===');
    compound.forEach(name => {
        const found = indexes.find(i => i.name === name);
        console.log(`  ${found ? '✓' : '✗'} ${name}`);
    });

    const oldGlobal = ['email_1', 'userName_1'];
    console.log('\n=== Old global indexes (should be GONE) ===');
    oldGlobal.forEach(name => {
        const found = indexes.find(i => i.name === name && i.unique);
        console.log(`  ${found ? '✗ STILL EXISTS' : '✓ removed'} ${name}`);
    });

    await mongoose.disconnect();
})();
