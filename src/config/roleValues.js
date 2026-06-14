/**
 * Role-value helpers for the RBAC migration.
 *
 * The legacy `User.role` enum is being phased out in favour of dynamic roles
 * (`User.roleId` → `Role.permissions[]`). During the transition the DB holds a
 * mix of old and new enum values, so anywhere we still need to identify a user
 * by their broad role *category* we must match BOTH:
 *   - customer:  legacy 'USER'  → new 'CUSTOMER'
 *   - owner:     legacy 'ADMIN' → new 'OWNER'
 *
 * Capability checks ("can this user do X") should prefer permissions
 * (req.user.permissions / requirePermission middleware). These helpers are for
 * identity checks only (is this person a customer vs staff/owner).
 */

const CUSTOMER_ROLE_VALUES = ['USER', 'CUSTOMER'];
const OWNER_ROLE_VALUES = ['ADMIN', 'OWNER'];

const isCustomerRole = (role) => CUSTOMER_ROLE_VALUES.includes(role);
const isOwnerRole = (role) => OWNER_ROLE_VALUES.includes(role);
const isSuperAdminRole = (role) => role === 'SUPER_ADMIN';

/**
 * Resolve the active user IDs in a tenant whose dynamic role grants a given
 * permission. Used for permission-based notification fan-out (instead of
 * hardcoding legacy role names like 'DISPATCH').
 */
const findTenantUserIdsByPermission = async (tenantId, permission) => {
    const Role = require('../models/roleModel');
    const User = require('../models/userModel');
    const roles = await Role.find({
        $or: [{ tenantId }, { tenantId: null }],
        permissions: permission,
        isActive: true,
    }).select('_id');
    if (roles.length === 0) return [];
    const roleIds = roles.map((r) => r._id);
    const users = await User.find({
        tenantId,
        roleId: { $in: roleIds },
        isActive: true,
    }).select('_id');
    return users.map((u) => u._id);
};

module.exports = {
    CUSTOMER_ROLE_VALUES,
    OWNER_ROLE_VALUES,
    isCustomerRole,
    isOwnerRole,
    isSuperAdminRole,
    findTenantUserIdsByPermission,
};
