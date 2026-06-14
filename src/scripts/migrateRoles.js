/**
 * Migrate existing users to the dynamic-role schema.
 *
 *   SUPER_ADMIN → roleId = super-admin role (role stays SUPER_ADMIN)
 *   ADMIN       → roleId = owner role,      role renamed to OWNER
 *   USER        → roleId = customer role,   role renamed to CUSTOMER
 *   DISPATCH / PRODUCTION / MARKETING → DELETED (fresh-start per plan)
 *
 * Pre-req: run `node src/scripts/seedSystemRoles.js` first.
 *
 * Usage:
 *   node src/scripts/migrateRoles.js --dry-run    (preview, no writes)
 *   node src/scripts/migrateRoles.js              (apply migration)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/userModel');
const Role = require('../models/roleModel');

const ROLE_MAP = {
    SUPER_ADMIN: { newRole: 'SUPER_ADMIN', slug: 'super-admin' },
    ADMIN: { newRole: 'OWNER', slug: 'owner' },
    USER: { newRole: 'CUSTOMER', slug: 'customer' },
};

const DELETE_ROLES = new Set(['DISPATCH', 'PRODUCTION', 'MARKETING']);

async function loadSystemRoles() {
    const roles = {};
    for (const { slug } of Object.values(ROLE_MAP)) {
        const role = await Role.findOne({ slug, tenantId: null });
        if (!role) {
            throw new Error(
                `System role "${slug}" not found. Run "node src/scripts/seedSystemRoles.js" first.`
            );
        }
        roles[slug] = role;
    }
    return roles;
}

async function migrate(dryRun) {
    console.log(`\n🚀 Migrating user roles${dryRun ? '  (DRY RUN — no writes)' : ''}\n`);

    const systemRoles = await loadSystemRoles();
    const users = await User.find({})
        .select('_id role roleId firstName lastName email userName mobileNumber')
        .lean();

    console.log(`📊 Total users found: ${users.length}\n`);

    let migrated = 0;
    let deleted = 0;
    let alreadyOk = 0;
    let skipped = 0;
    const deleteIds = [];

    for (const user of users) {
        const label =
            `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
            user.email ||
            user.userName ||
            user.mobileNumber ||
            user._id.toString();

        // Fresh-start: drop legacy team roles
        if (DELETE_ROLES.has(user.role)) {
            console.log(`  🗑️  ${label.padEnd(30)} role=${user.role.padEnd(11)} → DELETE`);
            deleteIds.push(user._id);
            deleted++;
            continue;
        }

        // Already migrated (OWNER / CUSTOMER / SUPER_ADMIN with roleId set)
        if (user.roleId && ['OWNER', 'CUSTOMER', 'SUPER_ADMIN'].includes(user.role)) {
            const expectedSlug = user.role === 'OWNER'
                ? 'owner'
                : user.role === 'CUSTOMER'
                    ? 'customer'
                    : 'super-admin';
            const expected = systemRoles[expectedSlug];
            if (expected && user.roleId.toString() === expected._id.toString()) {
                console.log(`  ✓  ${label.padEnd(30)} role=${user.role.padEnd(11)} → already migrated`);
                alreadyOk++;
                continue;
            }
        }

        const mapping = ROLE_MAP[user.role];
        if (!mapping) {
            console.log(`  ⚠️  ${label.padEnd(30)} role=${user.role || '?'} → no mapping, SKIP`);
            skipped++;
            continue;
        }

        const targetRole = systemRoles[mapping.slug];
        console.log(`  ✏️  ${label.padEnd(30)} ${user.role.padEnd(11)} → ${mapping.newRole.padEnd(8)} (roleId=${targetRole._id})`);

        if (!dryRun) {
            await User.updateOne(
                { _id: user._id },
                {
                    $set: {
                        role: mapping.newRole,
                        roleId: targetRole._id,
                        'permissionOverrides.grant': [],
                        'permissionOverrides.revoke': [],
                    },
                }
            );
        }
        migrated++;
    }

    if (!dryRun && deleteIds.length > 0) {
        const res = await User.deleteMany({ _id: { $in: deleteIds } });
        console.log(`\n🗑️  Deleted ${res.deletedCount} users (DISPATCH / PRODUCTION / MARKETING)`);
    }

    console.log('\n📊 Summary:');
    console.log(`   ${migrated} migrated`);
    console.log(`   ${deleted} ${dryRun ? 'will be deleted' : 'deleted'}`);
    console.log(`   ${alreadyOk} already migrated`);
    console.log(`   ${skipped} skipped (unknown role)`);

    if (dryRun) {
        console.log('\n⚠️  DRY RUN — no actual writes. Re-run without --dry-run to apply.');
    } else {
        console.log('\n✅ Migration complete');
    }
}

async function run() {
    if (!process.env.MONGO_URI) {
        console.error('❌ MONGO_URI not set. Create a .env file or set the env variable.');
        process.exit(1);
    }

    const dryRun = process.argv.includes('--dry-run');

    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        await migrate(dryRun);

        await mongoose.connection.close();
        console.log('\n✅ DB connection closed');
        process.exit(0);
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        if (err.stack) console.error(err.stack);
        await mongoose.connection.close().catch(() => {});
        process.exit(1);
    }
}

if (require.main === module) {
    run();
}

module.exports = { migrate };
