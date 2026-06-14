/**
 * Catalog of tenant-facing feature modules that a SUPER ADMIN can flip between
 * "live" and "under development". An under-development module still appears in
 * the menu, but opening it shows a placeholder screen instead of the feature.
 *
 * `key` matches the sidebar/drawer route key used by the clients.
 */
// Default module catalog (seeded into the Module collection). `type` drives
// which audience sees the module: customer | owner | both.
const MODULES = [
    { key: 'dashboard', label: 'Dashboard', type: 'both', order: 1 },
    { key: 'products', label: 'Products', type: 'both', order: 2 },
    { key: 'orders', label: 'Orders', type: 'both', order: 3 },
    { key: 'notifications', label: 'Notifications', type: 'both', order: 4 },
    { key: 'feedback', label: 'Feedback', type: 'both', order: 5 },
    { key: 'categories', label: 'Categories', type: 'owner', order: 6 },
    { key: 'customers', label: 'Customers', type: 'owner', order: 7 },
    { key: 'dispatch', label: 'Dispatch', type: 'owner', order: 8 },
    { key: 'production', label: 'Production', type: 'owner', order: 9 },
    { key: 'marketing', label: 'Marketing', type: 'owner', order: 10 },
    { key: 'visits', label: 'Visits', type: 'owner', order: 11 },
    { key: 'promotions', label: 'Promotions', type: 'owner', order: 12 },
    { key: 'roles', label: 'Modules & Permissions', type: 'owner', order: 13 },
    { key: 'settings', label: 'Settings', type: 'owner', order: 14 },
];

const MODULE_KEYS = MODULES.map((m) => m.key);
const isValidModuleKey = (key) => MODULE_KEYS.includes(key);

module.exports = { MODULES, MODULE_KEYS, isValidModuleKey };
