/**
 * Permission resolution — computes the effective permission set for a user.
 *
 * Resolution chain (priority order):
 *   1. super-admin slug   → returns ALL permissions (bypass)
 *   2. role.permissions[] → base set from the user's role
 *   3. overrides.grant[]  → union — add extras
 *   4. overrides.revoke[] → subtract — explicit deny wins over grant
 *
 * Result is embedded in the JWT at login, so per-request checks make
 * zero DB calls.
 */
const { ALL_PERMISSIONS } = require('../config/permissions');

const SUPER_ADMIN_SLUG = 'super-admin';
const OWNER_SLUG = 'owner';
const CUSTOMER_SLUG = 'customer';

/**
 * @param  {Object}  role        — populated Role doc (or plain object with slug + permissions)
 * @param  {Object}  overrides   — { grant: string[], revoke: string[] } (optional)
 * @returns {string[]}             effective permission keys
 */
const computeEffectivePermissions = (role, overrides) => {
    if (!role) return [];

    // Super-admin bypass: gets every permission, ignoring overrides.
    if (role.slug === SUPER_ADMIN_SLUG) {
        return [...ALL_PERMISSIONS];
    }

    const set = new Set(Array.isArray(role.permissions) ? role.permissions : []);

    if (overrides) {
        if (Array.isArray(overrides.grant)) {
            overrides.grant.forEach((p) => set.add(p));
        }
        if (Array.isArray(overrides.revoke)) {
            overrides.revoke.forEach((p) => set.delete(p));
        }
    }

    return Array.from(set);
};

/**
 * In-memory check against a pre-computed permission array.
 * Used by middleware after reading permissions from JWT.
 */
const hasPermission = (effectivePermissions, key) => {
    if (!Array.isArray(effectivePermissions)) return false;
    return effectivePermissions.includes(key);
};

module.exports = {
    computeEffectivePermissions,
    hasPermission,
    SUPER_ADMIN_SLUG,
    OWNER_SLUG,
    CUSTOMER_SLUG,
};
