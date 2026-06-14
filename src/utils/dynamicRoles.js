/**
 * Dynamic (activatable) roles — catalog templates + per-tenant editable copies.
 *
 * Model:
 *  - SUPER ADMIN owns the CATALOG: global templates (tenantId: null, isDefault)
 *    that define which role TYPES exist and their DEFAULT permissions.
 *  - When an OWNER activates a role, a per-tenant COPY is created (seeded from
 *    the template). The owner then edits THAT copy's permissions to control
 *    their own staff — without affecting other tenants.
 *  - Activation state lives in tenant.enabledRoles (slugs). An active role's
 *    slug === the sidebar module it unlocks.
 *  - Owner & Customer remain always-on system baseline roles (seedSystemRoles.js).
 */
const Role = require('../models/roleModel');
const {
    DISPATCH_PERMISSIONS,
    PRODUCTION_PERMISSIONS,
    MARKETING_PERMISSIONS,
} = require('../config/permissions');

const DYNAMIC_ROLE_DEFS = [
    { name: 'Dispatch', slug: 'dispatch', description: 'Handles order fulfilment — view orders, dispatch and mark delivered.', permissions: DISPATCH_PERMISSIONS },
    { name: 'Production', slug: 'production', description: 'Manages the catalog — products, variants and stock.', permissions: PRODUCTION_PERMISSIONS },
    { name: 'Marketing', slug: 'marketing', description: 'Field sales — log visits, onboard customers, browse catalog and banners.', permissions: MARKETING_PERMISSIONS },
];

const DYNAMIC_SLUGS = DYNAMIC_ROLE_DEFS.map((d) => d.slug);
const isDynamicSlug = (slug) => DYNAMIC_SLUGS.includes(slug);

// Always-on roles: owner-editable per-tenant copies that are NEVER toggled off
// (every business has them). Customer is one — owners tune what their buyers can do.
const ALWAYS_ON_SLUGS = ['customer'];
const isAlwaysOnSlug = (slug) => ALWAYS_ON_SLUGS.includes(slug);
// Any per-tenant editable role copy (toggleable OR always-on).
const isEditableCopySlug = (slug) => isDynamicSlug(slug) || isAlwaysOnSlug(slug);

/** Seed the global dynamic-role CATALOG templates (idempotent). */
const seedDynamicRoles = async () => {
    const out = [];
    for (const def of DYNAMIC_ROLE_DEFS) {
        let role = await Role.findOne({ tenantId: null, slug: def.slug });
        if (!role) {
            role = await Role.create({
                tenantId: null,
                name: def.name,
                slug: def.slug,
                description: def.description,
                isSystemRole: false,
                isDefault: true,
                scope: 'tenant',
                permissions: def.permissions,
                isActive: true,
            });
            out.push({ slug: def.slug, created: true });
        } else {
            out.push({ slug: def.slug, created: false });
        }
    }
    return out;
};

/**
 * Find or create a tenant's editable COPY of a dynamic role, seeded from the
 * global template (falls back to the static default permissions).
 */
const ensureTenantRoleCopy = async (tenantId, slug, createdBy = null) => {
    let copy = await Role.findOne({ tenantId, slug });
    if (copy) return copy;

    const template = await Role.findOne({ tenantId: null, slug }).lean();
    const def = DYNAMIC_ROLE_DEFS.find((d) => d.slug === slug);
    if (!template && !def) return null; // unknown dynamic role

    copy = await Role.create({
        tenantId,
        name: template?.name || def?.name || slug,
        slug,
        description: template?.description || def?.description || '',
        isSystemRole: false,
        isDefault: true,
        scope: 'tenant',
        permissions: template?.permissions || def?.permissions || [],
        isActive: true,
        createdBy,
    });
    return copy;
};

/** Resolve (creating if needed) a tenant's copy id for staff/customer assignment. */
const getTenantRoleId = async (tenantId, slug) => {
    const copy = await ensureTenantRoleCopy(tenantId, slug);
    return copy ? copy._id : null;
};

/** Ensure a tenant's always-on editable role copies exist (Customer). */
const ensureTenantBaselineRoles = async (tenantId, createdBy = null) => {
    for (const slug of ALWAYS_ON_SLUGS) {
        await ensureTenantRoleCopy(tenantId, slug, createdBy);
    }
};

module.exports = {
    DYNAMIC_ROLE_DEFS,
    DYNAMIC_SLUGS,
    ALWAYS_ON_SLUGS,
    isDynamicSlug,
    isAlwaysOnSlug,
    isEditableCopySlug,
    seedDynamicRoles,
    ensureTenantRoleCopy,
    ensureTenantBaselineRoles,
    getTenantRoleId,
};
