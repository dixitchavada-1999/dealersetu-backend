const jwt = require('jsonwebtoken');

/**
 * JWT payload shape
 * -----------------
 * Embedded once at login so per-request permission checks never hit the DB.
 *
 *   {
 *     id,                  // user _id
 *     tenantId,            // user's tenant (null for super-admin)
 *     role,                // legacy role string (kept for backward compat)
 *     roleSlug,            // role document's slug — 'super-admin' | 'owner' | 'customer' | <custom>
 *     isSuperAdmin,        // boolean — fast bypass flag
 *     permissions,         // effective permission keys: ['products.read', ...]
 *     permissionVersion,   // tenant.permissionVersion at issuance — invalidation key
 *   }
 */

const assertSecret = () => {
    if (!process.env.JWT_SECRET) {
        throw new Error('JWT_SECRET environment variable is not set. Please set it in Railway Environment Variables.');
    }
};

/**
 * Generate Access Token (short-lived, 1 day).
 *
 * @param  {string|ObjectId} id       — user _id
 * @param  {Object}          payload  — { role, roleSlug, isSuperAdmin, tenantId, permissions, permissionVersion }
 */
const generateAccessToken = (id, payload = {}) => {
    assertSecret();
    const secret = process.env.JWT_SECRET + id.toString();
    const body = {
        id,
        tenantId: payload.tenantId ?? null,
        role: payload.role ?? null,
        roleSlug: payload.roleSlug ?? null,
        isSuperAdmin: !!payload.isSuperAdmin,
        permissions: Array.isArray(payload.permissions) ? payload.permissions : [],
        permissionVersion: typeof payload.permissionVersion === 'number' ? payload.permissionVersion : 0,
    };
    return jwt.sign(body, secret, { expiresIn: '1d' });
};

/**
 * Generate Refresh Token (long-lived, 30 days).
 * Carries only the user id; permissions are re-resolved on refresh.
 */
const generateRefreshToken = (id) => {
    assertSecret();
    const secret = (process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh') + id.toString();
    return jwt.sign({ id }, secret, { expiresIn: '30d' });
};

/**
 * Generate both access and refresh tokens.
 *
 * Supports two calling styles for backward compatibility:
 *   - generateTokens(id, payloadObject)
 *   - generateTokens(id, roleString, tenantId)   ← legacy
 */
const generateTokens = (id, payloadOrRole, tenantId) => {
    const payload = typeof payloadOrRole === 'object' && payloadOrRole !== null
        ? payloadOrRole
        : { role: payloadOrRole, tenantId };
    return {
        accessToken: generateAccessToken(id, payload),
        refreshToken: generateRefreshToken(id),
    };
};

// Backward-compat default export — accepts the legacy (id, role, tenantId) signature
// as well as the new (id, payloadObject) signature.
const generateToken = (id, payloadOrRole, tenantId) => {
    const payload = typeof payloadOrRole === 'object' && payloadOrRole !== null
        ? payloadOrRole
        : { role: payloadOrRole, tenantId };
    return generateAccessToken(id, payload);
};

module.exports = generateToken;
module.exports.generateTokens = generateTokens;
module.exports.generateAccessToken = generateAccessToken;
module.exports.generateRefreshToken = generateRefreshToken;
