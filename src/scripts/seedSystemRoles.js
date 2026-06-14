/**
 * Seed the three immutable system roles.
 *
 * Usage:   node src/scripts/seedSystemRoles.js
 * Safety:  idempotent — safe to re-run; updates existing rows if the
 *          permission catalog in code has changed.
 *
 * System roles created here:
 *   - super-admin → platform admin; bypasses checks (gets ALL permissions)
 *   - owner       → tenant owner; full tenant CRUD (template shared by all tenants)
 *   - customer    → dealer / buyer; minimal browse + place-order permissions
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Role = require('../models/roleModel');
const {
    ALL_PERMISSIONS,
    OWNER_PERMISSIONS,
    CUSTOMER_PERMISSIONS,
} = require('../config/permissions');

const SYSTEM_ROLES = [
    {
        name: 'Super Admin',
        slug: 'super-admin',
        description: 'Platform administrator with full access to all tenants and system settings.',
        isSystemRole: true,
        scope: 'platform',
        tenantId: null,
        permissions: ALL_PERMISSIONS,
        isActive: true,
    },
    {
        name: 'Owner',
        slug: 'owner',
        description: 'Tenant owner. Full access to their tenant data and team management.',
        isSystemRole: true,
        scope: 'platform', // template shared by all tenant owners
        tenantId: null,
        permissions: OWNER_PERMISSIONS,
        isActive: true,
    },
    {
        name: 'Customer',
        slug: 'customer',
        description: 'Dealer / buyer. Can browse products, place orders, and submit feedback.',
        isSystemRole: true,
        scope: 'platform',
        tenantId: null,
        permissions: CUSTOMER_PERMISSIONS,
        isActive: true,
    },
    // NOTE: Dispatch / Production / Marketing are NOT system roles — each tenant
    // gets its own editable copy via utils/provisionTenantRoles.js so owners can
    // tune permissions per business.
];

const arraysEqualAsSets = (a, b) => {
    if (a.length !== b.length) return false;
    const setA = new Set(a);
    return b.every((x) => setA.has(x));
};

async function seedSystemRoles() {
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const roleData of SYSTEM_ROLES) {
        const existing = await Role.findOne({ slug: roleData.slug, tenantId: null });

        if (!existing) {
            const doc = await Role.create(roleData);
            console.log(`  ✅ Created: ${roleData.name.padEnd(12)} → ${doc._id}  (${roleData.permissions.length} perms)`);
            created++;
            continue;
        }

        const same =
            existing.isSystemRole === true &&
            existing.scope === roleData.scope &&
            existing.name === roleData.name &&
            existing.description === roleData.description &&
            existing.isActive === true &&
            arraysEqualAsSets(existing.permissions || [], roleData.permissions);

        if (same) {
            console.log(`  ⏭️  Unchanged: ${roleData.name.padEnd(12)} → ${existing._id}`);
            unchanged++;
            continue;
        }

        existing.name = roleData.name;
        existing.description = roleData.description;
        existing.isSystemRole = true;
        existing.scope = roleData.scope;
        existing.tenantId = null;
        existing.permissions = roleData.permissions;
        existing.isActive = true;
        await existing.save();
        console.log(`  🔄 Updated: ${roleData.name.padEnd(12)} → ${existing._id}  (${roleData.permissions.length} perms)`);
        updated++;
    }

    console.log(`\n📊 Summary: ${created} created · ${updated} updated · ${unchanged} unchanged`);
}

async function run() {
    if (!process.env.MONGO_URI) {
        console.error('❌ MONGO_URI not set. Create a .env file or set the env variable.');
        process.exit(1);
    }

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB\n');
        console.log('🌱 Seeding system roles...\n');

        await seedSystemRoles();

        await mongoose.connection.close();
        console.log('\n✅ Done — DB connection closed');
        process.exit(0);
    } catch (err) {
        console.error('❌ Seed failed:', err.message);
        await mongoose.connection.close().catch(() => {});
        process.exit(1);
    }
}

if (require.main === module) {
    run();
}

module.exports = { seedSystemRoles, SYSTEM_ROLES };
