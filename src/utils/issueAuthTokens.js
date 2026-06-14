/**
 * Single source of truth for issuing JWTs.
 *
 * Every login flow (password, OTP, code, auto, refresh, switch-tenant, activate)
 * goes through this helper so permissions, role slug, super-admin flag, and
 * tenant.permissionVersion are always embedded consistently.
 */
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const { generateTokens, generateAccessToken } = require('./generateToken');
const { computeEffectivePermissions } = require('./permissionResolver');

/**
 * Load user with role populated, compute effective permissions, fetch the
 * tenant's permissionVersion, and assemble the JWT payload.
 *
 * @param {ObjectId|string} userId
 * @returns {{
 *   payload: { tenantId, role, roleSlug, isSuperAdmin, permissions, permissionVersion },
 *   user,
 *   role,
 * }}
 */
const resolveAuthPayload = async (userId) => {
    const user = await User.findById(userId).populate('roleId');
    if (!user) throw new Error('User not found');

    const role = user.roleId; // populated Role doc, or null for users created before migration
    const permissions = role
        ? computeEffectivePermissions(role, user.permissionOverrides)
        : [];

    let permissionVersion = 0;
    if (user.tenantId) {
        const tenant = await Tenant.findById(user.tenantId).select('permissionVersion').lean();
        permissionVersion = typeof tenant?.permissionVersion === 'number' ? tenant.permissionVersion : 0;
    }

    const isSuperAdmin = (role && role.slug === 'super-admin') || user.role === 'SUPER_ADMIN';

    return {
        payload: {
            tenantId: user.tenantId,
            role: user.role,
            roleSlug: role?.slug || null,
            isSuperAdmin,
            permissions,
            permissionVersion,
        },
        user,
        role,
    };
};

/**
 * Issue access + refresh tokens with permissions baked in.
 */
const issueAuthTokens = async (userId) => {
    const { payload, user } = await resolveAuthPayload(userId);
    return generateTokens(user._id, payload);
};

/**
 * Issue a fresh access token (used by POST /refresh-token).
 * Re-resolves permissions so any role/perm change is picked up.
 */
const issueAccessToken = async (userId) => {
    const { payload, user } = await resolveAuthPayload(userId);
    return generateAccessToken(user._id, payload);
};

module.exports = {
    issueAuthTokens,
    issueAccessToken,
    resolveAuthPayload,
};
