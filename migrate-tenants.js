/**
 * MongoDB Migration Script: Add Tenant documents for existing users
 *
 * Run this script ONCE to create Tenant documents for existing admin users
 * and update all users to reference the new Tenant.
 *
 * Usage:
 *   node migrate-tenants.js
 *
 * What it does:
 *   1. For each ADMIN user: creates a Tenant document with name "[firstName]'s Business"
 *   2. Updates the admin's tenantId to reference the new Tenant _id
 *   3. For any USER without a loginCode: generates one
 *   4. Sets isDeviceLocked = false for all existing users
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const dotenv = require('dotenv');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/api-shop';

// Generate unique 8-char alphanumeric login code
const generateLoginCode = async (usersCollection) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code;
    let exists = true;
    while (exists) {
        code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(crypto.randomInt(chars.length));
        }
        const found = await usersCollection.findOne({ loginCode: code });
        exists = !!found;
    }
    return code;
};

async function migrate() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected successfully.\n');

        const db = mongoose.connection.db;
        const usersCollection = db.collection('users');
        const tenantsCollection = db.collection('tenants');

        // ── 1. Create Tenant documents for ADMIN users ──
        console.log('=== Creating Tenant documents for Admin users ===');
        const admins = await usersCollection.find({ role: 'ADMIN' }).toArray();
        console.log(`Found ${admins.length} admin user(s).`);

        let tenantsCreated = 0;
        const tenantMap = {}; // oldTenantId -> newTenantId

        for (const admin of admins) {
            const oldTenantId = admin.tenantId?.toString();

            // Check if a Tenant already exists for this tenantId
            if (oldTenantId) {
                const existingTenant = await tenantsCollection.findOne({ _id: admin.tenantId });
                if (existingTenant) {
                    console.log(`  - ${admin.firstName || admin.name || admin.email}: Tenant already exists, skipping.`);
                    tenantMap[oldTenantId] = admin.tenantId;
                    continue;
                }
            }

            // Create new Tenant
            const tenantName = admin.firstName
                ? `${admin.firstName}'s Business`
                : admin.name
                    ? `${admin.name.split(' ')[0]}'s Business`
                    : `Business`;

            const tenantDoc = {
                name: tenantName,
                email: admin.email || '',
                isActive: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = await tenantsCollection.insertOne(tenantDoc);
            const newTenantId = result.insertedId;

            // Update admin user's tenantId
            await usersCollection.updateOne(
                { _id: admin._id },
                { $set: { tenantId: newTenantId } }
            );

            if (oldTenantId) {
                tenantMap[oldTenantId] = newTenantId;
            }

            tenantsCreated++;
            console.log(`  - ${admin.firstName || admin.name || admin.email}: Created tenant "${tenantName}" (${newTenantId})`);
        }
        console.log(`Created ${tenantsCreated} tenant(s).\n`);

        // ── 2. Update USER accounts with matching tenantIds ──
        console.log('=== Updating USER accounts ===');
        const users = await usersCollection.find({ role: 'USER' }).toArray();
        console.log(`Found ${users.length} user(s).`);

        let usersUpdated = 0;
        for (const user of users) {
            const oldTenantId = user.tenantId?.toString();
            const updates = {};

            // Update tenantId if we have a mapping
            if (oldTenantId && tenantMap[oldTenantId]) {
                updates.tenantId = tenantMap[oldTenantId];
            }

            // Generate loginCode if missing
            if (!user.loginCode) {
                updates.loginCode = await generateLoginCode(usersCollection);
            }

            // Set isDeviceLocked to false
            if (user.isDeviceLocked === undefined || user.isDeviceLocked === null) {
                updates.isDeviceLocked = false;
            }

            if (Object.keys(updates).length > 0) {
                await usersCollection.updateOne(
                    { _id: user._id },
                    { $set: updates }
                );
                usersUpdated++;
                console.log(`  - ${user.firstName || user.name || user._id}: Updated (loginCode: ${updates.loginCode || user.loginCode || 'exists'})`);
            }
        }
        console.log(`Updated ${usersUpdated} user(s).\n`);

        // ── 3. Ensure all admins have isDeviceLocked set ──
        console.log('=== Setting isDeviceLocked for all users ===');
        const result = await usersCollection.updateMany(
            { isDeviceLocked: { $exists: false } },
            { $set: { isDeviceLocked: false } }
        );
        console.log(`Set isDeviceLocked=false for ${result.modifiedCount} user(s).\n`);

        console.log('=== Migration Complete ===');
        console.log(`Summary:`);
        console.log(`  - Tenants created: ${tenantsCreated}`);
        console.log(`  - Users updated: ${usersUpdated}`);

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected from MongoDB.');
    }
}

migrate();
