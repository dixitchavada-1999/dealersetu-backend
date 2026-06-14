/**
 * Permission Catalog — master list of every permission in the platform.
 *
 * Format: "module.action"   e.g. "products.create", "orders.approve"
 *
 * Adding a permission requires three steps:
 *   1. Add it here.
 *   2. Add `requirePermission('module.action')` to the protecting route.
 *   3. Add the matching <Can permission="module.action"> on the UI.
 *
 * Permission scope:
 *   - tenant   — usable by Owner & tenant-level custom roles
 *   - platform — Super Admin only; never granted to tenant roles
 */

const PERMISSION_CATALOG = {
    // ── Tenant-scope ──────────────────────────────────────────────
    products: {
        label: 'Products',
        scope: 'tenant',
        actions: {
            read: 'View products',
            create: 'Create products',
            update: 'Edit products',
            delete: 'Delete products',
        },
    },
    variants: {
        label: 'Product Variants',
        scope: 'tenant',
        actions: {
            read: 'View variants',
            create: 'Create variants',
            update: 'Edit variants',
            delete: 'Delete variants',
            updateStock: 'Update stock levels',
        },
    },
    categories: {
        label: 'Categories',
        scope: 'tenant',
        actions: {
            read: 'View categories',
            create: 'Create categories',
            update: 'Edit categories',
            delete: 'Delete categories',
        },
    },
    customers: {
        label: 'Customers',
        scope: 'tenant',
        actions: {
            read: 'View customers',
            create: 'Create customers',
            update: 'Edit customers',
            delete: 'Delete customers',
        },
    },
    orders: {
        label: 'Orders',
        scope: 'tenant',
        actions: {
            read: 'View orders',
            create: 'Place orders',
            update: 'Edit orders',
            delete: 'Delete orders',
            approve: 'Approve orders',
            dispatch: 'Dispatch orders',
            deliver: 'Mark orders as delivered',
            cancel: 'Cancel orders',
        },
    },
    banners: {
        label: 'Banners',
        scope: 'tenant',
        actions: {
            read: 'View banners',
            create: 'Create banners',
            update: 'Edit banners',
            delete: 'Delete banners',
        },
    },
    visits: {
        label: 'Visits',
        scope: 'tenant',
        actions: {
            read: 'View visits',
            create: 'Log visits',
            update: 'Edit visits',
            approve: 'Approve visits',
            reject: 'Reject visits',
        },
    },
    feedback: {
        label: 'Feedback',
        scope: 'tenant',
        actions: {
            read: 'View feedback',
            create: 'Submit feedback',
            reply: 'Reply to feedback',
            delete: 'Delete feedback',
        },
    },
    dashboard: {
        label: 'Dashboard',
        scope: 'tenant',
        actions: {
            read: 'View dashboard',
        },
    },
    team: {
        label: 'Team Members',
        scope: 'tenant',
        actions: {
            read: 'View team',
            create: 'Add team member',
            update: 'Edit team member',
            delete: 'Remove team member',
        },
    },
    roles: {
        label: 'Roles & Permissions',
        scope: 'tenant',
        actions: {
            read: 'View roles',
            create: 'Create custom roles',
            update: 'Edit roles',
            delete: 'Delete roles',
        },
    },
    settings: {
        label: 'Settings',
        scope: 'tenant',
        actions: {
            read: 'View settings',
            update: 'Update settings',
        },
    },
    notifications: {
        label: 'Notifications',
        scope: 'tenant',
        actions: {
            read: 'View notifications',
            update: 'Mark as read / unread',
        },
    },

    // ── Platform-scope (Super Admin only) ─────────────────────────
    tenants: {
        label: 'Tenants',
        scope: 'platform',
        actions: {
            read: 'View tenants',
            create: 'Create tenant',
            update: 'Edit tenant',
            toggle: 'Activate / deactivate tenant',
        },
    },
    activitylogs: {
        label: 'Activity Logs',
        scope: 'platform',
        actions: {
            read: 'View activity logs',
        },
    },
    systemroles: {
        label: 'System Roles',
        scope: 'platform',
        actions: {
            read: 'View system roles',
            create: 'Create system role',
            update: 'Edit system role',
            delete: 'Delete system role',
        },
    },
};

const flatten = (predicate) =>
    Object.entries(PERMISSION_CATALOG)
        .filter(([, def]) => (predicate ? predicate(def) : true))
        .flatMap(([module, def]) => Object.keys(def.actions).map((action) => `${module}.${action}`));

const ALL_PERMISSIONS = flatten();
const TENANT_ALLOWED_PERMISSIONS = flatten((def) => def.scope === 'tenant');
const PLATFORM_ONLY_PERMISSIONS = flatten((def) => def.scope === 'platform');

// Owner gets every tenant-scope permission by default — full tenant admin.
const OWNER_PERMISSIONS = TENANT_ALLOWED_PERMISSIONS;

// Customer gets a minimal buyer set — browse + place own orders.
// `dashboard.read` is included so customers can see their own dashboard;
// the dashboard controller returns per-role data (customer sees their orders).
const CUSTOMER_PERMISSIONS = [
    'dashboard.read',
    'products.read',
    'variants.read',
    'categories.read',
    'banners.read',
    'orders.read',
    'orders.create',
    'feedback.read',
    'feedback.create',
    'notifications.read',
    'notifications.update',
];

// ── Fixed staff roles (standard, seeded per system) ───────────────
// Dispatch: handle order fulfilment — see orders, dispatch & mark delivered.
const DISPATCH_PERMISSIONS = [
    'dashboard.read',
    'orders.read',
    'orders.dispatch',
    'orders.deliver',
    'products.read',
    'categories.read',
    'notifications.read',
    'notifications.update',
];

// Production: manage the catalog — products, variants, stock.
const PRODUCTION_PERMISSIONS = [
    'dashboard.read',
    'products.read',
    'products.create',
    'products.update',
    'variants.read',
    'variants.create',
    'variants.update',
    'variants.updateStock',
    'categories.read',
    'orders.read',
    'notifications.read',
    'notifications.update',
];

// Marketing: field sales — log visits, onboard customers, browse catalog/banners.
const MARKETING_PERMISSIONS = [
    'dashboard.read',
    'customers.read',
    'customers.create',
    'visits.read',
    'visits.create',
    'visits.update',
    'products.read',
    'banners.read',
    'notifications.read',
    'notifications.update',
];

// Which permission MODULES are relevant to each fixed role — used to scope the
// permission editor so (e.g.) the Customer role doesn't show admin-only modules.
// Derived from each role's default permission set. Roles not listed (owner,
// super-admin, custom) get the full catalog.
const PERMISSION_SETS_BY_SLUG = {
    customer: CUSTOMER_PERMISSIONS,
    dispatch: DISPATCH_PERMISSIONS,
    production: PRODUCTION_PERMISSIONS,
    marketing: MARKETING_PERMISSIONS,
};

// Explicit editor scope for roles whose visible modules should NOT just mirror
// their full permission set. Customer keeps browse-support perms (variants/
// categories/banners) silently, but the editor only shows their menu modules.
const ROLE_EDITOR_MODULES = {
    customer: ['dashboard', 'products', 'orders', 'notifications', 'feedback'],
};

/** Module keys to SHOW in the editor for a role slug, or null for "all modules". */
const getRoleScopeModules = (slug) => {
    if (ROLE_EDITOR_MODULES[slug]) return ROLE_EDITOR_MODULES[slug];
    const set = PERMISSION_SETS_BY_SLUG[slug];
    if (!set) return null;
    return [...new Set(set.map((p) => p.split('.')[0]))];
};

const isValidPermission = (key) => ALL_PERMISSIONS.includes(key);

const validatePermissions = (perms) => {
    if (!Array.isArray(perms)) return { valid: false, invalid: ['<not-an-array>'] };
    const invalid = perms.filter((p) => !isValidPermission(p));
    return { valid: invalid.length === 0, invalid };
};

module.exports = {
    PERMISSION_CATALOG,
    ALL_PERMISSIONS,
    TENANT_ALLOWED_PERMISSIONS,
    PLATFORM_ONLY_PERMISSIONS,
    OWNER_PERMISSIONS,
    CUSTOMER_PERMISSIONS,
    DISPATCH_PERMISSIONS,
    PRODUCTION_PERMISSIONS,
    MARKETING_PERMISSIONS,
    getRoleScopeModules,
    isValidPermission,
    validatePermissions,
};
