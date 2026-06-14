/**
 * Permission-based route guards.
 *
 * Usage:
 *   router.get('/',  protect, requirePermission('products.read'),  handler);
 *   router.post('/', protect, requireAnyPermission(['products.create','products.update']), handler);
 *
 * Permissions are read from req.user.permissions, which is populated by
 * authMiddleware from the JWT payload — zero DB calls per request.
 */
const { isValidPermission } = require('../config/permissions');

const ensureKnown = (key) => {
    if (!isValidPermission(key)) {
        throw new Error(`Unknown permission key: "${key}". Add it to config/permissions.js.`);
    }
};

const checkAuthenticated = (req, res) => {
    if (!req.user) {
        res.status(401).json({ success: false, message: 'Not authenticated' });
        return false;
    }
    return true;
};

/**
 * Block the request unless the user has the given permission.
 * Super-admin's JWT already contains every permission, so no special case here.
 */
const requirePermission = (permissionKey) => {
    ensureKnown(permissionKey);

    return (req, res, next) => {
        if (!checkAuthenticated(req, res)) return;

        const perms = req.user.permissions;
        if (!Array.isArray(perms) || !perms.includes(permissionKey)) {
            return res.status(403).json({
                success: false,
                message: `Permission denied: ${permissionKey}`,
            });
        }
        next();
    };
};

/**
 * Allow the request if the user has ANY of the listed permissions.
 */
const requireAnyPermission = (keys) => {
    keys.forEach(ensureKnown);

    return (req, res, next) => {
        if (!checkAuthenticated(req, res)) return;

        const perms = req.user.permissions;
        if (!Array.isArray(perms) || !keys.some((k) => perms.includes(k))) {
            return res.status(403).json({
                success: false,
                message: `Permission denied: requires one of ${keys.join(', ')}`,
            });
        }
        next();
    };
};

/**
 * Allow the request only if the user has ALL listed permissions.
 */
const requireAllPermissions = (keys) => {
    keys.forEach(ensureKnown);

    return (req, res, next) => {
        if (!checkAuthenticated(req, res)) return;

        const perms = req.user.permissions;
        if (!Array.isArray(perms) || !keys.every((k) => perms.includes(k))) {
            return res.status(403).json({
                success: false,
                message: `Permission denied: requires all of ${keys.join(', ')}`,
            });
        }
        next();
    };
};

/**
 * Restrict to SUPER_ADMIN system role.
 * Uses isSuperAdmin flag baked into the JWT.
 */
const requireSuperAdmin = (req, res, next) => {
    if (!checkAuthenticated(req, res)) return;
    if (!req.user.isSuperAdmin) {
        return res.status(403).json({ success: false, message: 'Super Admin only' });
    }
    next();
};

module.exports = {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    requireSuperAdmin,
};
