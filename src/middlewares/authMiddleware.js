const jwt = require('jsonwebtoken');
const User = require('../models/userModel');

// @desc    Protect routes — verify JWT, validate session + permission version
const protect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            token = req.headers.authorization.split(' ')[1];

            // Decode (without verify) to get userId for the user-specific secret
            const decoded = jwt.decode(token);
            if (!decoded || !decoded.id) {
                res.status(401);
                throw new Error('Invalid token');
            }

            // Verify with user-specific secret
            const secret = process.env.JWT_SECRET + decoded.id.toString();
            jwt.verify(token, secret);

            // Single DB query: load user + populate tenant for isActive +
            // permissionVersion checks. Using .lean() returns a plain JS
            // object that we can freely augment with JWT-derived fields.
            const user = await User.findById(decoded.id)
                .select('-password -refreshToken -resetPasswordToken -resetPasswordExpires')
                .populate('tenantId', 'isActive permissionVersion')
                .lean();

            if (!user) {
                res.status(401);
                throw new Error('Not authorized, user not found');
            }

            if (!user.isActive) {
                res.status(403);
                throw new Error('Your account has been deactivated. Please contact administrator.');
            }

            const isSuperAdminUser = !!decoded.isSuperAdmin || user.role === 'SUPER_ADMIN';

            // Tenant suspension + permission-version check (super-admin has no tenant)
            if (!isSuperAdminUser && user.tenantId) {
                const tenantDoc = user.tenantId; // populated tenant doc
                if (tenantDoc && tenantDoc.isActive === false) {
                    res.status(403);
                    throw new Error('Your account has been suspended. Please contact administrator.');
                }
                if (
                    tenantDoc &&
                    typeof decoded.permissionVersion === 'number' &&
                    typeof tenantDoc.permissionVersion === 'number' &&
                    tenantDoc.permissionVersion > decoded.permissionVersion
                ) {
                    res.status(401);
                    throw new Error('Permissions updated. Please re-login.');
                }
            }

            // Flatten the populated tenant reference back to a plain ObjectId
            // so downstream code that does `req.user.tenantId.equals(...)` keeps working.
            const tenantId = user.tenantId?._id || user.tenantId || null;

            req.user = {
                ...user,
                tenantId,
                // RBAC fields from JWT — no extra DB call
                permissions: Array.isArray(decoded.permissions) ? decoded.permissions : [],
                roleSlug: decoded.roleSlug || null,
                isSuperAdmin: !!isSuperAdminUser,
                permissionVersion: typeof decoded.permissionVersion === 'number' ? decoded.permissionVersion : 0,
            };

            // Update session activity (fire-and-forget; failure here must not break auth)
            try {
                require('../services/sessionService').updateLastActivity(req.user._id);
            } catch (sessionErr) {
                // Swallow — session bookkeeping must never break the request
            }

            next();
        } catch (error) {
            console.error('Auth error:', error.message);
            if (!res.headersSent) {
                const status = res.statusCode >= 400 ? res.statusCode : 401;
                res.status(status);
                throw new Error(error.message || 'Not authorized, token failed');
            }
        }
    } else {
        res.status(401);
        throw new Error('Not authorized, no token provided');
    }
};

module.exports = { protect };
