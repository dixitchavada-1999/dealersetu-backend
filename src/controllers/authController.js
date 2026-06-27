const mongoose = require('mongoose');
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const Role = require('../models/roleModel');
const { generateTokens, generateAccessToken } = require('../utils/generateToken');
const { issueAuthTokens, issueAccessToken } = require('../utils/issueAuthTokens');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { NOTIFICATION_TYPES } = require('../constants/notificationTypes');
const { createNotification, notifyTenantAdmins } = require('../services/notificationService');
const { logActivity } = require('../utils/activityLogger');
const sessionService = require('../services/sessionService');
const Otp = require('../models/otpModel');
const { sendOtpSms, normalizeMobile } = require('../services/smsService');
const { getTenantRoleId, ensureTenantBaselineRoles } = require('../utils/dynamicRoles');

// ── Role transition constants ──
// During the RBAC migration both legacy (ADMIN/USER) and new (OWNER/CUSTOMER)
// role names can coexist. Queries use $in to match either; role checks use
// these Sets for membership tests.
const OWNER_ROLE_VALUES = ['ADMIN', 'OWNER'];
const CUSTOMER_ROLE_VALUES = ['USER', 'CUSTOMER'];
const OWNER_LIKE = new Set(OWNER_ROLE_VALUES);
const CUSTOMER_LIKE = new Set(CUSTOMER_ROLE_VALUES);

// Cache system role _ids in-memory (per process) — looked up once on first use.
let _systemRoleCache = null;
const getSystemRoleId = async (slug) => {
    if (!_systemRoleCache) {
        const roles = await Role.find({
            tenantId: null,
            isSystemRole: true,
            slug: { $in: ['super-admin', 'owner', 'customer'] },
        }).select('_id slug');
        _systemRoleCache = {};
        roles.forEach((r) => { _systemRoleCache[r.slug] = r._id; });
    }
    return _systemRoleCache[slug];
};

// OTP configuration
const OTP_LENGTH = 6;
const OTP_EXPIRY_MINUTES = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 30;
const OTP_MAX_ATTEMPTS = 3;

const generateOtp = () => {
    const min = Math.pow(10, OTP_LENGTH - 1);
    const max = Math.pow(10, OTP_LENGTH) - 1;
    return String(crypto.randomInt(min, max + 1));
};

/**
 * Generate unique 8-char alphanumeric login code
 */
const generateLoginCode = async () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars: I,O,0,1
    let code;
    let exists = true;
    while (exists) {
        code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(crypto.randomInt(chars.length));
        }
        exists = await User.findOne({ loginCode: code });
    }
    return code;
};

/**
 * Transform user object to match frontend format
 */
const transformUserResponse = (user, tenant) => {
    const isCustomer = CUSTOMER_LIKE.has(user.role);
    const isOwnerOrAdmin = OWNER_LIKE.has(user.role);
    return {
        id: user._id.toString(),
        firstName: user.firstName || user.name?.split(' ')[0] || '',
        lastName: user.lastName || user.name?.split(' ').slice(1).join(' ') || '',
        email: user.email || '',
        userName: user.userName || (user.email ? user.email.split('@')[0] : ''),
        mobileNumber: user.mobileNumber || '',
        // Legacy `roleId` field on the response is actually the role STRING
        // for the existing frontend — keep emitting it so old clients don't break.
        // The actual Role document _id is exposed separately as `roleRef`.
        roleId: user.role,
        roleRef: user.roleId ? user.roleId.toString() : null,
        tenantId: user.tenantId?.toString() || '',
        loginCode: isCustomer ? (user.loginCode || '') : undefined,
        isPasswordSet: isCustomer ? !!user.isPasswordSet : undefined,
        isAdmin: isOwnerOrAdmin,
        // Explicit customer flag so clients don't have to infer it by elimination
        // (which misclassifies custom-role staff as customers).
        isCustomer,
        isDispatch: user.role === 'DISPATCH',
        isProduction: user.role === 'PRODUCTION',
        isMarketing: user.role === 'MARKETING',
        isSuperAdmin: user.role === 'SUPER_ADMIN',
        tenant: tenant ? {
            id: tenant._id.toString(),
            name: tenant.name,
            businessType: tenant.businessType || '',
            phone: tenant.phone || '',
            email: tenant.email || '',
            address: tenant.address || '',
            logo: tenant.logo || '',
            // Dynamic roles the owner switched ON — drives sidebar module gating.
            enabledRoles: Array.isArray(tenant.enabledRoles) ? tenant.enabledRoles : [],
            dispatchPermissions: tenant.dispatchPermissions || {
                dashboard: false,
                categories: false,
                products: false,
                orders: true,
            },
            productionPermissions: tenant.productionPermissions || {
                dashboard: false,
                categories: false,
                products: false,
                orders: true,
            },
            marketingPermissions: tenant.marketingPermissions || {
                dashboard: false,
                categories: false,
                products: false,
                orders: true,
                customers: false,
            },
        } : undefined,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
    };
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
const registerAdmin = async (req, res, next) => {
    try {
        const {
            name,  // Backward compatibility
            firstName,
            lastName,
            email,
            userName,
            password,
            mobileNumber,
            deviceId,
            businessName,
        } = req.body;

        // Check database connection first
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: 'Database connection unavailable. Please check server configuration.',
                data: null,
                errors: [],
            });
        }

        // Check JWT_SECRET is set
        if (!process.env.JWT_SECRET) {
            return res.status(500).json({
                success: false,
                message: 'JWT_SECRET environment variable is not set. Please set it in Railway Environment Variables.',
                data: null,
                errors: [],
            });
        }

        // Validate input - accept either name OR firstName+lastName
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password',
                data: null,
                errors: [],
            });
        }

        if (!name && (!firstName || !lastName)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide name or firstName and lastName',
                data: null,
                errors: [],
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a valid email address',
                data: null,
                errors: [],
            });
        }

        // Validate password strength
        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long',
                data: null,
                errors: [],
            });
        }

        // Check if user already exists
        const userExists = await User.findOne({ 
            $or: [
                { email },
                ...(userName ? [{ userName }] : [])
            ]
        });
        
        if (userExists) {
            return res.status(400).json({
                success: false,
                message: userExists.email === email 
                    ? 'Email already registered' 
                    : 'Username already taken',
                data: null,
                errors: [],
            });
        }

        // Create Tenant document
        const resolvedFirstName = firstName || name?.split(' ')[0] || '';
        const resolvedLastName = lastName || name?.split(' ').slice(1).join(' ') || '';
        const tenant = await Tenant.create({
            name: businessName || `${resolvedFirstName}'s Business`,
            email,
        });

        // Resolve Owner system role for the new tenant admin
        const ownerRoleId = await getSystemRoleId('owner');
        if (!ownerRoleId) {
            return res.status(500).json({
                success: false,
                message: 'Owner system role not found. Run "node src/scripts/seedSystemRoles.js" first.',
                data: null,
                errors: [],
            });
        }

        // Create owner user (legacy role string stays as 'OWNER' for transition)
        const user = await User.create({
            tenantId: tenant._id,
            name: name || `${firstName} ${lastName}`,
            firstName: resolvedFirstName,
            lastName: resolvedLastName,
            userName: userName || email.split('@')[0],
            email,
            mobileNumber,
            password,
            role: 'OWNER',
            roleId: ownerRoleId,
            isActive: true,
            deviceId,
        });

        // Toggleable dynamic roles (Dispatch/Production/Marketing) are created
        // lazily on activation. Always-on editable roles (Customer) are
        // provisioned now so the owner can tune them from day one.
        await ensureTenantBaselineRoles(tenant._id, user._id);

        // Issue tokens AFTER user is saved so the JWT carries the real userId
        // (used by user-specific JWT secret + permission embedding)
        const tokens = await issueAuthTokens(user._id);
        user.refreshToken = tokens.refreshToken;
        await user.save();

        if (user) {
            logActivity({ req: { ...req, user: { _id: user._id, tenantId: tenant._id, firstName: user.firstName, lastName: user.lastName, role: 'OWNER' } }, action: 'register', module: 'auth', description: `Owner registered: ${user.email}`, targetId: user._id, targetName: user.email });

            return res.status(201).json({
                success: true,
                message: 'User registered successfully',
                data: {
                    user: transformUserResponse(user, tenant),
                    tokens: tokens,
                },
            });
        }
    } catch (error) {
        console.error('Registration error:', error);
        
        // Handle MongoDB duplicate key errors
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`,
                data: null,
                errors: [],
            });
        }

        // Handle validation errors
        if (error.name === 'ValidationError') {
            const errors = Object.values(error.errors).map(err => ({
                msg: err.message,
                param: err.path,
            }));
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                data: null,
                errors: errors,
            });
        }

        // Handle database connection errors
        if (error.name === 'MongoServerError' || error.message.includes('Mongo')) {
            return res.status(503).json({
                success: false,
                message: 'Database connection error. Please try again later.',
                data: null,
                errors: [],
            });
        }

        return res.status(500).json({
            success: false,
            message: error.message || 'Registration failed',
            data: null,
            errors: [],
        });
    }
};

// Resolve an active login candidate when a matched USER's tenant is deactivated.
// If the customer has another User account (same mobileNumber) under an active
// tenant, switch to that one. If no active tenant exists, return { suspended: true }
// so the caller can block the login with a clear message.
const resolveActiveLoginCandidate = async (matchedUser, password, { verifyPassword = true } = {}) => {
    if (!matchedUser || !CUSTOMER_LIKE.has(matchedUser.role) || !matchedUser.tenantId) {
        return { user: matchedUser };
    }

    const currentTenant = await Tenant.findById(matchedUser.tenantId).select('isActive');
    if (currentTenant && currentTenant.isActive) {
        return { user: matchedUser };
    }

    // Current tenant is inactive — search for an active sibling tenant
    if (!matchedUser.mobileNumber) {
        return { suspended: true };
    }

    const siblings = await User.find({
        mobileNumber: matchedUser.mobileNumber,
        role: { $in: CUSTOMER_ROLE_VALUES },
        isActive: true,
        _id: { $ne: matchedUser._id },
    });

    for (const sib of siblings) {
        const sibTenant = await Tenant.findById(sib.tenantId).select('isActive');
        if (!sibTenant || !sibTenant.isActive) continue;

        if (verifyPassword && password) {
            if (!sib.password) continue;
            const matches = await sib.matchPassword(password);
            if (!matches) continue;
        }
        return { user: sib };
    }

    return { suspended: true };
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
const loginUser = async (req, res, next) => {
    try {
        const { email, userName, mobileNumber, password, deviceId } = req.body;

        // Check database connection
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({ success: false, message: 'Database connection unavailable. Please check server configuration.', data: null, errors: [] });
        }

        // Check JWT_SECRET is set
        if (!process.env.JWT_SECRET) {
            return res.status(500).json({ success: false, message: 'JWT_SECRET environment variable is not set.', data: null, errors: [] });
        }

        // Validate input
        if ((!email && !userName && !mobileNumber) || !password) {
            return res.status(400).json({ success: false, message: 'Please provide email/phone/username and password', data: null, errors: [] });
        }

        // Build lookup query — support email, userName, or mobileNumber.
        // Mobile numbers are stored inconsistently (some raw 10-digit, some E.164
        // "+91…"), so match against EVERY plausible form rather than a single
        // normalized one — otherwise raw-stored customers can never log in.
        const orConditions = [];
        if (email) orConditions.push({ email: String(email).toLowerCase().trim() });
        if (userName) orConditions.push({ userName: String(userName) });
        if (mobileNumber) {
            const cleaned = String(mobileNumber).replace(/[\s\-()]/g, '');
            const bare = cleaned.replace(/^\+/, '');           // drop a leading +
            const variants = new Set([
                normalizeMobile(mobileNumber),                 // +911234567890
                cleaned,                                       // as typed (cleaned)
                bare,                                          // 911234567890
                bare.replace(/^91(?=\d{10}$)/, ''),            // 1234567890 (strip 91 cc)
            ].filter(Boolean));
            variants.forEach((m) => orConditions.push({ mobileNumber: m }));
        }

        let user = await User.findOne({ $or: orConditions });

        // Check if user exists and password matches
        if (user && user.password && (await user.matchPassword(password))) {

            if (CUSTOMER_LIKE.has(user.role) && !user.isPasswordSet) {
                return res.status(403).json({
                    success: false,
                    message: 'Account not yet activated. Please use your activation code to set a password first.',
                    data: { needsActivation: true },
                    errors: [],
                });
            }

            // Check if user is active
            if (!user.isActive) {
                return res.status(403).json({ success: false, message: 'Your account has been deactivated. Please contact administrator.', data: null, errors: [] });
            }

            // If matched user's tenant is deactivated, fall back to an active sibling
            // tenant (multi-tenant customers). If no active tenant exists, block login.
            if (CUSTOMER_LIKE.has(user.role)) {
                const resolved = await resolveActiveLoginCandidate(user, password, { verifyPassword: true });
                if (resolved.suspended) {
                    return res.status(403).json({
                        success: false,
                        message: 'Your account has been suspended. Please contact administrator.',
                        data: null,
                        errors: [],
                    });
                }
                user = resolved.user;
            }

            // Device lock for CUSTOMER role
            if (CUSTOMER_LIKE.has(user.role)) {
                if (user.isDeviceLocked && user.deviceId && deviceId && user.deviceId !== deviceId) {
                    return res.status(403).json({ success: false, message: 'Account locked to another device. Ask your admin to reset device lock.', data: null, errors: [] });
                }
                if (!user.isDeviceLocked && deviceId) {
                    user.deviceId = deviceId;
                    user.isDeviceLocked = true;
                }
            }

            // Generate tokens (permissions + roleSlug + permissionVersion embedded)
            const tokens = await issueAuthTokens(user._id);

            // Update user with deviceId and refreshToken
            if (deviceId && !CUSTOMER_LIKE.has(user.role)) {
                user.deviceId = deviceId;
            }
            user.refreshToken = tokens.refreshToken;
            await user.save();

            // Fetch tenant info (Super Admin has no tenant)
            const tenant = user.tenantId ? await Tenant.findById(user.tenantId) : null;

            // Find available tenants for CUSTOMER role (same mobileNumber across tenants)
            let availableTenants = [];
            if (CUSTOMER_LIKE.has(user.role) && user.mobileNumber) {
                const otherUsers = await User.find({ mobileNumber: user.mobileNumber, role: { $in: CUSTOMER_ROLE_VALUES }, isActive: true, deactivatedByCustomer: { $ne: true }, _id: { $ne: user._id } }).select('tenantId');
                const allTenantIds = [user.tenantId, ...otherUsers.map(u => u.tenantId)];
                const tenants = await Tenant.find({ _id: { $in: allTenantIds }, isActive: true }).select('name businessType logo');
                availableTenants = tenants.map(t => ({ id: t._id.toString(), name: t.name, businessType: t.businessType || '', logo: t.logo || '', isCurrent: t._id.toString() === user.tenantId.toString() }));
            }

            logActivity({ req: { ...req, user }, action: 'login', module: 'auth', description: 'User logged in', targetId: user._id, targetName: user.email || user.mobileNumber || user.userName });
            sessionService.createSession({ userId: user._id, tenantId: user.tenantId, ipAddress: req.ip, deviceInfo: { userAgent: req.headers['user-agent'] }, loginMethod: mobileNumber ? 'mobile_password' : 'email' });

            return res.status(200).json({
                success: true,
                message: 'Login successful',
                data: {
                    user: transformUserResponse(user, tenant),
                    tokens,
                    ...(availableTenants.length > 1 ? { availableTenants } : {}),
                },
            });
        } else {
            return res.status(401).json({ success: false, message: 'Invalid credentials', data: null, errors: [] });
        }
    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Login failed', data: null, errors: [] });
    }
};

// @desc    Auto-login with device ID
// @route   POST /api/auth/auto-login
// @access  Public
const autoLogin = async (req, res, next) => {
    try {
        const { deviceId } = req.body;

        // Check database connection
        if (mongoose.connection.readyState !== 1) {
            return res.status(503).json({
                success: false,
                message: 'Database connection unavailable. Please check server configuration.',
                data: null,
                errors: [],
            });
        }

        // Check JWT_SECRET is set
        if (!process.env.JWT_SECRET) {
            return res.status(500).json({
                success: false,
                message: 'JWT_SECRET environment variable is not set. Please set it in Railway Environment Variables.',
                data: null,
                errors: [],
            });
        }

        if (!deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Device ID is required',
                data: null,
                errors: [],
            });
        }

        // Find user by deviceId
        const user = await User.findOne({ deviceId, isActive: true });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'No active session found for this device',
                data: null,
                errors: [],
            });
        }

        // For CUSTOMER role: verify deviceId matches exactly (enforce single device)
        if (CUSTOMER_LIKE.has(user.role) && user.isDeviceLocked && user.deviceId !== deviceId) {
            return res.status(403).json({
                success: false,
                message: 'Account locked to another device',
                data: null,
                errors: [],
            });
        }

        // Block auto-login if the user's tenant has been deactivated by superadmin
        if (user.tenantId) {
            const userTenant = await Tenant.findById(user.tenantId).select('isActive');
            if (!userTenant || !userTenant.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been suspended. Please contact administrator.',
                    data: null,
                    errors: [],
                });
            }
        }

        // Non-customer roles (Owner + team) get their deviceId refreshed on auto-login
        if (!CUSTOMER_LIKE.has(user.role)) {
            user.deviceId = deviceId;
        }

        // Generate new tokens (permissions embedded)
        const tokens = await issueAuthTokens(user._id);

        // Update refresh token
        user.refreshToken = tokens.refreshToken;
        await user.save();

        // Fetch tenant info
        const tenant = await Tenant.findById(user.tenantId);

        // Find available tenants for this user (same mobileNumber across tenants)
        let availableTenants = [];
        if (CUSTOMER_LIKE.has(user.role) && user.mobileNumber) {
            const otherUsers = await User.find({
                mobileNumber: user.mobileNumber,
                role: { $in: CUSTOMER_ROLE_VALUES },
                isActive: true,
                deactivatedByCustomer: { $ne: true },
                _id: { $ne: user._id },
            }).select('tenantId');

            const otherTenantIds = otherUsers.map(u => u.tenantId);
            const allTenantIds = [user.tenantId, ...otherTenantIds];

            const tenants = await Tenant.find({ _id: { $in: allTenantIds }, isActive: true }).select('name businessType logo');
            availableTenants = tenants.map(t => ({
                id: t._id.toString(),
                name: t.name,
                businessType: t.businessType || '',
                logo: t.logo || '',
                isCurrent: t._id.toString() === user.tenantId.toString(),
            }));
        }

        sessionService.createSession({ userId: user._id, tenantId: user.tenantId, ipAddress: req.ip, deviceInfo: { userAgent: req.headers['user-agent'] }, loginMethod: 'auto_login' });

        return res.status(200).json({
            success: true,
            message: 'Auto-login successful',
            data: {
                user: transformUserResponse(user, tenant),
                tokens: tokens,
                availableTenants: availableTenants.length > 1 ? availableTenants : [],
            },
        });
    } catch (error) {
        console.error('Auto-login error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Auto-login failed',
            data: null,
            errors: [],
        });
    }
};

// @desc    Logout user (clear device ID)
// @route   POST /api/auth/logout
// @access  Public
const logout = async (req, res, next) => {
    try {
        const { refreshToken, userId } = req.body;

        // Try to find user by refreshToken or userId
        const query = {};
        if (refreshToken) query.refreshToken = refreshToken;
        if (userId) query._id = userId;

        if (Object.keys(query).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token or user ID is required',
                data: null,
                errors: [],
            });
        }

        const user = await User.findOne(query);

        if (user) {
            // Clear deviceId and refreshToken
            user.deviceId = undefined;
            user.refreshToken = undefined;
            await user.save();

            logActivity({ req: { ...req, user }, action: 'logout', module: 'auth', description: 'User logged out', targetId: user._id, targetName: user.email || user.loginCode });

            sessionService.closeSession(req.body.userId || req.user?._id);
        }

        return res.status(200).json({
            success: true,
            message: 'Logout successful',
            data: {},
        });
    } catch (error) {
        console.error('Logout error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Logout failed',
            data: null,
            errors: [],
        });
    }
};

// @desc    Refresh access token
// @route   POST /api/auth/refresh-token
// @access  Public
const refreshAccessToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                message: 'Refresh token is required',
                data: null,
                errors: [],
            });
        }

        // Check JWT_SECRET is set
        if (!process.env.JWT_SECRET) {
            return res.status(500).json({
                success: false,
                message: 'JWT_SECRET environment variable is not set. Please set it in Railway Environment Variables.',
                data: null,
                errors: [],
            });
        }

        // Verify refresh token with user-specific secret
        const decoded = jwt.decode(refreshToken);
        if (!decoded || !decoded.id) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token',
                data: null,
                errors: [],
            });
        }
        const refreshSecret = (process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET + '_refresh') + decoded.id.toString();
        jwt.verify(refreshToken, refreshSecret, { algorithms: ['HS256'] });

        // Find user
        const user = await User.findOne({ 
            _id: decoded.id, 
            refreshToken: refreshToken,
            isActive: true 
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid refresh token',
                data: null,
                errors: [],
            });
        }

        // Re-resolve permissions on refresh so any role/perm change is picked up
        const accessToken = await issueAccessToken(user._id);

        return res.status(200).json({
            success: true,
            message: 'Token refreshed successfully',
            data: {
                accessToken: accessToken,
            },
        });
    } catch (error) {
        console.error('Refresh token error:', error);
        if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired refresh token',
                data: null,
                errors: [],
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Refresh token failed',
            data: null,
            errors: [],
        });
    }
};

// @desc    Update password (requires authentication)
// @route   POST /api/auth/update-password
// @access  Private
const updatePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user?.id; // From auth middleware

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Please provide current and new password',
                data: null,
                errors: [],
            });
        }

        const user = await User.findById(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
                data: null,
                errors: [],
            });
        }

        // Verify current password
        if (!(await user.matchPassword(currentPassword))) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect',
                data: null,
                errors: [],
            });
        }

        // Update password
        user.password = newPassword;
        await user.save();

        return res.status(200).json({
            success: true,
            message: 'Password updated successfully',
            data: {},
        });
    } catch (error) {
        console.error('Update password error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Password update failed',
            data: null,
            errors: [],
        });
    }
};

// @desc    Forgot Password
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
    try {
        const { email, mobileNumber } = req.body;
        if (!email && !mobileNumber) {
            return res.status(400).json({ success: false, message: 'Email or mobile number is required' });
        }

        // Find user by email or mobileNumber
        let user;
        if (email) {
            user = await User.findOne({ email: email.toLowerCase(), isActive: true });
        } else {
            user = await User.findOne({ mobileNumber: normalizeMobile(mobileNumber), isActive: true });
        }

        if (!user) {
            return res.json({ success: true, message: 'If an account exists, a reset OTP has been sent.' });
        }

        // For mobile-only lookup: user must have email to receive OTP
        if (!user.email) {
            return res.status(400).json({ success: false, message: 'No email address on file. Please contact your admin to reset your password.' });
        }

        // Generate 6-digit OTP (cryptographically secure, not Math.random)
        const otp = String(crypto.randomInt(100000, 1000000));
        user.resetPasswordToken = otp;
        user.resetPasswordExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 min
        await user.save();

        // Send email via the dynamic template system (key: 'password_reset').
        // Super-admin can edit this template; falls back to the built-in default.
        const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
        await sendTemplatedEmail('password_reset', user.email, {
            otp,
            name: user.firstName || user.name || 'there',
        });

        res.json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Failed to process request. Please try again.' });
    }
};

// @desc    Reset Password
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res, next) => {
    try {
        const { email, otp, newPassword } = req.body;
        if (!email || !otp || !newPassword) {
            return res.status(400).json({ success: false, message: 'Email, OTP, and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
        }

        const user = await User.findOne({
            email: email.toLowerCase(),
            resetPasswordToken: otp,
            resetPasswordExpires: { $gt: new Date() },
            isActive: true,
        });

        if (!user) {
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
        }

        user.password = newPassword; // Will be hashed by pre-save hook
        user.isPasswordSet = true; // Mark as activated (in case USER resets password)
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.json({ success: true, message: 'Password reset successfully. You can now login with your new password.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'Failed to reset password. Please try again.' });
    }
};

// @desc    Create team member (by admin)
// @route   POST /api/team
// @access  Private/Admin
const createTeamMember = async (req, res, next) => {
    try {
        const { name, firstName, lastName, email, mobileNumber, shopName, gstNumber, address } = req.body;
        const adminUser = req.user;

        if (!name && !firstName) {
            return res.status(400).json({
                success: false,
                message: 'Please provide a name',
                data: null,
                errors: [],
            });
        }

        // Generate unique login code
        const loginCode = await generateLoginCode();

        // Resolve this tenant's editable Customer role copy (owner-tunable).
        const customerRoleId = await getTenantRoleId(adminUser.tenantId, 'customer');
        if (!customerRoleId) {
            return res.status(500).json({
                success: false,
                message: 'Customer role could not be resolved. Run "node src/scripts/seedSystemRoles.js" first.',
                data: null,
                errors: [],
            });
        }

        // Create customer
        const user = await User.create({
            tenantId: adminUser.tenantId,
            name: name || `${firstName || ''} ${lastName || ''}`.trim(),
            firstName: firstName || (name ? name.split(' ')[0] : ''),
            lastName: lastName || (name ? name.split(' ').slice(1).join(' ') : ''),
            email: email || undefined,
            mobileNumber: mobileNumber || '',
            shopName: shopName || '',
            gstNumber: gstNumber || '',
            address: address || {},
            loginCode,
            role: 'CUSTOMER',
            roleId: customerRoleId,
            isActive: true,
            isDeviceLocked: false,
        });

        res.status(201).json({
            success: true,
            message: 'Customer created successfully',
            data: {
                id: user._id.toString(),
                name: user.name || '',
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email || '',
                mobileNumber: user.mobileNumber || '',
                shopName: user.shopName || '',
                gstNumber: user.gstNumber || '',
                loginCode: user.loginCode,
                isDeviceLocked: user.isDeviceLocked,
                deviceId: user.deviceId || '',
                address: user.address || {},
                role: user.role,
                isActive: user.isActive,
                createdAt: user.createdAt,
            },
        });

        logActivity({ req, action: 'create', module: 'team', description: `Customer created: ${user.name || user.firstName}`, targetId: user._id, targetName: user.name || user.firstName });

        // Fire-and-forget: send welcome notification
        createNotification({
            tenantId: adminUser.tenantId,
            recipientId: user._id,
            type: NOTIFICATION_TYPES.WELCOME,
            title: 'Welcome!',
            message: `Welcome to ${adminUser.shopName || 'our platform'}! Your activation code is ${loginCode}`,
            data: {},
        });

        // Fire-and-forget: send welcome / activation code via email or SMS.
        // Uses the dynamic 'customer_welcome' template (super-admin editable).
        try {
            if (email) {
                const { sendTemplatedEmail } = require('../utils/sendTemplatedEmail');
                sendTemplatedEmail('customer_welcome', email, {
                    name: user.firstName || user.name || 'there',
                    loginCode,
                    shopName: adminUser.shopName || 'DealerSetu',
                })
                    .then(info => console.log(`✅ customer_welcome email sent to ${email} -> ${info?.messageId || 'ok'} (accepted: ${JSON.stringify(info?.accepted || [])})`))
                    .catch(err => console.error(`❌ customer_welcome email FAILED for ${email} — check SMTP_* env vars / Brevo sender verification:`, err.message));
            } else if (mobileNumber) {
                sendOtpSms(normalizeMobile(mobileNumber), loginCode)
                    .catch(err => console.error('Activation SMS send error:', err.message));
            } else {
                console.warn('⚠️ Customer created without email or mobile — activation code not delivered. loginCode:', loginCode);
            }
        } catch (sendErr) {
            console.error('Welcome code delivery error:', sendErr.message);
        }

        return;
    } catch (error) {
        console.error('Create team member error:', error);
        if (error.code === 11000) {
            // For compound { tenantId, email/userName/mobileNumber } indexes,
            // surface the customer-facing field (not tenantId) in the message.
            const fields = Object.keys(error.keyPattern || {});
            const conflictField = fields.find(f => f !== 'tenantId') || fields[0] || 'field';
            return res.status(400).json({
                success: false,
                message: `A customer with this ${conflictField} already exists in your business.`,
                data: null,
                errors: [],
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to create team member',
            data: null,
            errors: [],
        });
    }
};

// @desc    Login with code (team members)
// @route   POST /api/auth/login-code
// @access  Public
const loginWithCode = async (req, res, next) => {
    try {
        const { loginCode, deviceId } = req.body;

        if (!loginCode || !deviceId) {
            return res.status(400).json({
                success: false,
                message: 'Login code and device ID are required',
                data: null,
                errors: [],
            });
        }

        // Find user by loginCode
        const user = await User.findOne({ loginCode: loginCode.toUpperCase(), isActive: true });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid login code',
                data: null,
                errors: [],
            });
        }

        // Check device lock
        if (user.isDeviceLocked && user.deviceId && user.deviceId !== deviceId) {
            return res.status(403).json({
                success: false,
                message: 'Account locked to another device. Ask your admin to reset device lock.',
                data: null,
                errors: [],
            });
        }

        // First login: lock to this device
        if (!user.isDeviceLocked) {
            user.deviceId = deviceId;
            user.isDeviceLocked = true;
        }

        // Generate tokens (permissions embedded)
        const tokens = await issueAuthTokens(user._id);
        user.refreshToken = tokens.refreshToken;
        await user.save();

        // Fetch tenant info
        const tenant = await Tenant.findById(user.tenantId);

        // Find available tenants for this user (same mobileNumber across tenants)
        let availableTenants = [];
        if (CUSTOMER_LIKE.has(user.role) && user.mobileNumber) {
            const otherUsers = await User.find({
                mobileNumber: user.mobileNumber,
                role: { $in: CUSTOMER_ROLE_VALUES },
                isActive: true,
                deactivatedByCustomer: { $ne: true },
                _id: { $ne: user._id },
            }).select('tenantId');

            const otherTenantIds = otherUsers.map(u => u.tenantId);
            const allTenantIds = [user.tenantId, ...otherTenantIds];

            const tenants = await Tenant.find({ _id: { $in: allTenantIds }, isActive: true }).select('name businessType logo');
            availableTenants = tenants.map(t => ({
                id: t._id.toString(),
                name: t.name,
                businessType: t.businessType || '',
                logo: t.logo || '',
                isCurrent: t._id.toString() === user.tenantId.toString(),
            }));
        }

        logActivity({ req: { ...req, user }, action: 'login', module: 'auth', description: `User logged in with code`, targetId: user._id, targetName: user.loginCode });

        sessionService.createSession({ userId: user._id, tenantId: user.tenantId, ipAddress: req.ip, deviceInfo: { userAgent: req.headers['user-agent'] }, loginMethod: 'login_code' });

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: transformUserResponse(user, tenant),
                tokens: tokens,
                availableTenants: availableTenants.length > 1 ? availableTenants : [],
            },
        });
    } catch (error) {
        console.error('Login with code error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Login failed',
            data: null,
            errors: [],
        });
    }
};

// @desc    Create dispatch user (by admin)
// @route   POST /api/team/dispatch
// @access  Private/Admin
const createDispatchUser = async (req, res, next) => {
    try {
        const { firstName, lastName, email, password, mobileNumber } = req.body;
        const adminUser = req.user;

        if (!firstName || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide firstName, email, and password',
                data: null,
                errors: [],
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters long',
                data: null,
                errors: [],
            });
        }

        const dispTenant = await Tenant.findById(adminUser.tenantId).select('enabledRoles').lean();
        if (!dispTenant?.enabledRoles?.includes('dispatch')) {
            return res.status(403).json({ success: false, message: 'Activate the Dispatch role for your business before adding dispatch staff.', data: null, errors: [] });
        }
        const dispatchRoleId = await getTenantRoleId(adminUser.tenantId, 'dispatch');

        const user = await User.create({
            tenantId: adminUser.tenantId,
            firstName,
            lastName: lastName || '',
            name: `${firstName} ${lastName || ''}`.trim(),
            email,
            password,
            mobileNumber: mobileNumber || '',
            role: 'DISPATCH',
            roleId: dispatchRoleId,
            isActive: true,
        });

        logActivity({ req, action: 'create', module: 'team', description: `Dispatch user created: ${user.email}`, targetId: user._id, targetName: user.email });

        return res.status(201).json({
            success: true,
            message: 'Dispatch user created successfully',
            data: {
                id: user._id.toString(),
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email || '',
                mobileNumber: user.mobileNumber || '',
                role: user.role,
                isActive: user.isActive,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt,
            },
        });
    } catch (error) {
        console.error('Create dispatch user error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(400).json({
                success: false,
                message: `${field} already exists`,
                data: null,
                errors: [],
            });
        }
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to create dispatch user',
            data: null,
            errors: [],
        });
    }
};

// @desc    Register Expo push token
// @route   PUT /api/auth/push-token
// @access  Private
const registerPushToken = async (req, res, next) => {
    try {
        const { expoPushToken } = req.body;

        if (!expoPushToken) {
            return res.status(400).json({
                success: false,
                message: 'Expo push token is required',
                data: null,
                errors: [],
            });
        }

        await User.findByIdAndUpdate(req.user._id, { expoPushToken });

        return res.status(200).json({
            success: true,
            message: 'Push token registered successfully',
            data: {},
        });
    } catch (error) {
        console.error('Register push token error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to register push token',
            data: null,
            errors: [],
        });
    }
};

// @desc    Switch tenant for USER role
// @route   POST /api/auth/switch-tenant
// @access  Private
const switchTenant = async (req, res, next) => {
    try {
        const { tenantId } = req.body;

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                message: 'Tenant ID is required',
                data: null,
                errors: [],
            });
        }

        // Current user must be a CUSTOMER role
        if (!CUSTOMER_LIKE.has(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Only customers can switch tenants',
                data: null,
                errors: [],
            });
        }

        // Find the user account in the target tenant with same mobileNumber
        const currentUser = await User.findById(req.user._id);
        if (!currentUser || !currentUser.mobileNumber) {
            return res.status(400).json({
                success: false,
                message: 'Cannot switch tenant - no mobile number linked',
                data: null,
                errors: [],
            });
        }

        const targetUser = await User.findOne({
            tenantId: tenantId,
            mobileNumber: currentUser.mobileNumber,
            role: { $in: CUSTOMER_ROLE_VALUES },
            isActive: true,
        });

        if (!targetUser) {
            return res.status(404).json({
                success: false,
                message: 'No account found in this business',
                data: null,
                errors: [],
            });
        }

        // Check tenant is active
        const targetTenant = await Tenant.findById(tenantId);
        if (!targetTenant || !targetTenant.isActive) {
            return res.status(404).json({
                success: false,
                message: 'Business not found or inactive',
                data: null,
                errors: [],
            });
        }

        // Generate new tokens for the target user (permissions embedded)
        const tokens = await issueAuthTokens(targetUser._id);
        targetUser.refreshToken = tokens.refreshToken;
        await targetUser.save();

        // Get available tenants
        const otherUsers = await User.find({
            mobileNumber: currentUser.mobileNumber,
            role: { $in: CUSTOMER_ROLE_VALUES },
            isActive: true,
            deactivatedByCustomer: { $ne: true },
        }).select('tenantId');

        const allTenantIds = [...new Set(otherUsers.map(u => u.tenantId.toString()))];
        const tenants = await Tenant.find({ _id: { $in: allTenantIds }, isActive: true }).select('name businessType logo');
        const availableTenants = tenants.map(t => ({
            id: t._id.toString(),
            name: t.name,
            businessType: t.businessType || '',
            logo: t.logo || '',
            isCurrent: t._id.toString() === tenantId,
        }));

        logActivity({ req: { ...req, user: { _id: targetUser._id, tenantId: targetUser.tenantId, firstName: targetUser.firstName, lastName: targetUser.lastName, role: targetUser.role } }, action: 'switch_tenant', module: 'auth', description: `Switched to tenant: ${targetTenant.name}`, targetId: targetTenant._id, targetName: targetTenant.name });

        sessionService.createSession({ userId: targetUser._id, tenantId: targetUser.tenantId, ipAddress: req.ip, deviceInfo: { userAgent: req.headers['user-agent'] }, loginMethod: 'switch_tenant' });

        return res.status(200).json({
            success: true,
            message: 'Switched business successfully',
            data: {
                user: transformUserResponse(targetUser, targetTenant),
                tokens: tokens,
                availableTenants: availableTenants.length > 1 ? availableTenants : [],
            },
        });
    } catch (error) {
        console.error('Switch tenant error:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Failed to switch business',
            data: null,
            errors: [],
        });
    }
};

// @desc    Send OTP to customer's mobile number
// @route   POST /api/auth/send-otp
// @access  Public
const sendOtp = async (req, res) => {
    try {
        const { mobileNumber } = req.body;
        if (!mobileNumber) {
            return res.status(400).json({ success: false, message: 'Mobile number is required', data: null, errors: [] });
        }

        const normalized = normalizeMobile(mobileNumber);

        // Verify user exists with this mobile number (customer role)
        const user = await User.findOne({ mobileNumber: normalized, role: { $in: CUSTOMER_ROLE_VALUES }, isActive: true });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'No account found with this mobile number. Ask your admin to add your mobile number.',
                data: null,
                errors: [],
            });
        }

        // Check resend cooldown — find most recent OTP for this mobile
        const recent = await Otp.findOne({ mobileNumber: normalized }).sort({ createdAt: -1 });
        if (recent) {
            const secondsSince = (Date.now() - recent.createdAt.getTime()) / 1000;
            if (secondsSince < OTP_RESEND_COOLDOWN_SECONDS) {
                const wait = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSince);
                return res.status(429).json({
                    success: false,
                    message: `Please wait ${wait}s before requesting a new OTP.`,
                    data: { retryAfter: wait },
                    errors: [],
                });
            }
        }

        // Invalidate previous unused OTPs for this mobile
        await Otp.deleteMany({ mobileNumber: normalized, verified: false });

        // Create new OTP
        const otp = generateOtp();
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
        await Otp.create({ mobileNumber: normalized, otp, expiresAt });

        // Send via SMS (dev mode logs to console)
        const result = await sendOtpSms(normalized, otp);

        return res.status(200).json({
            success: true,
            message: result.devMode
                ? `OTP sent (dev mode — check server console). Expires in ${OTP_EXPIRY_MINUTES} minutes.`
                : `OTP sent to ${normalized}. Expires in ${OTP_EXPIRY_MINUTES} minutes.`,
            data: {
                mobileNumber: normalized,
                expiresInSeconds: OTP_EXPIRY_MINUTES * 60,
                resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS,
                // Only return OTP in dev mode for easier testing
                ...(result.devMode && process.env.NODE_ENV !== 'production' ? { devOtp: otp } : {}),
            },
            errors: [],
        });
    } catch (error) {
        console.error('sendOtp error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to send OTP', data: null, errors: [] });
    }
};

// @desc    Verify OTP and login customer
// @route   POST /api/auth/verify-otp
// @access  Public
const verifyOtp = async (req, res) => {
    try {
        const { mobileNumber, otp, deviceId } = req.body;
        if (!mobileNumber || !otp || !deviceId) {
            return res.status(400).json({ success: false, message: 'Mobile number, OTP, and device ID are required', data: null, errors: [] });
        }

        const normalized = normalizeMobile(mobileNumber);

        // Find the most recent unverified OTP for this mobile
        const otpRecord = await Otp.findOne({ mobileNumber: normalized, verified: false }).sort({ createdAt: -1 });
        if (!otpRecord) {
            return res.status(400).json({ success: false, message: 'No active OTP found. Please request a new one.', data: null, errors: [] });
        }

        // Expired?
        if (otpRecord.expiresAt < new Date()) {
            await Otp.deleteOne({ _id: otpRecord._id });
            return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.', data: null, errors: [] });
        }

        // Max attempts exceeded?
        if (otpRecord.attempts >= OTP_MAX_ATTEMPTS) {
            await Otp.deleteOne({ _id: otpRecord._id });
            return res.status(429).json({ success: false, message: 'Too many wrong attempts. Please request a new OTP.', data: null, errors: [] });
        }

        // Verify OTP
        if (otpRecord.otp !== String(otp).trim()) {
            otpRecord.attempts += 1;
            await otpRecord.save();
            const remaining = OTP_MAX_ATTEMPTS - otpRecord.attempts;
            return res.status(400).json({
                success: false,
                message: remaining > 0 ? `Invalid OTP. ${remaining} attempt(s) remaining.` : 'Invalid OTP. Please request a new one.',
                data: null,
                errors: [],
            });
        }

        // Find user by mobile
        const user = await User.findOne({ mobileNumber: normalized, role: { $in: CUSTOMER_ROLE_VALUES }, isActive: true });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found', data: null, errors: [] });
        }

        // Device lock check
        if (user.isDeviceLocked && user.deviceId && user.deviceId !== deviceId) {
            return res.status(403).json({ success: false, message: 'Account locked to another device. Ask your admin to reset device lock.', data: null, errors: [] });
        }

        // First login: lock to this device
        if (!user.isDeviceLocked) {
            user.deviceId = deviceId;
            user.isDeviceLocked = true;
        }

        // Generate tokens (permissions embedded)
        const tokens = await issueAuthTokens(user._id);
        user.refreshToken = tokens.refreshToken;
        await user.save();

        // Mark OTP as verified and delete
        await Otp.deleteOne({ _id: otpRecord._id });

        // Fetch tenant info
        const tenant = await Tenant.findById(user.tenantId);

        // Find available tenants (same mobile across tenants)
        let availableTenants = [];
        const otherUsers = await User.find({
            mobileNumber: normalized,
            role: { $in: CUSTOMER_ROLE_VALUES },
            isActive: true,
            deactivatedByCustomer: { $ne: true },
            _id: { $ne: user._id },
        }).select('tenantId');

        const otherTenantIds = otherUsers.map(u => u.tenantId);
        const allTenantIds = [user.tenantId, ...otherTenantIds];
        const tenants = await Tenant.find({ _id: { $in: allTenantIds }, isActive: true }).select('name businessType logo');
        availableTenants = tenants.map(t => ({
            id: t._id.toString(),
            name: t.name,
            businessType: t.businessType || '',
            logo: t.logo || '',
            isCurrent: t._id.toString() === user.tenantId.toString(),
        }));

        logActivity({ req: { ...req, user }, action: 'login', module: 'auth', description: 'User logged in with OTP', targetId: user._id, targetName: user.mobileNumber });
        sessionService.createSession({ userId: user._id, tenantId: user.tenantId, ipAddress: req.ip, deviceInfo: { userAgent: req.headers['user-agent'] }, loginMethod: 'mobile_otp' });

        return res.status(200).json({
            success: true,
            message: 'Login successful',
            data: {
                user: transformUserResponse(user, tenant),
                tokens,
                availableTenants: availableTenants.length > 1 ? availableTenants : [],
            },
            errors: [],
        });
    } catch (error) {
        console.error('verifyOtp error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to verify OTP', data: null, errors: [] });
    }
};

// @desc    Activate customer account (first-time: verify code + set password)
// @route   POST /api/auth/activate-account
// @access  Public
const activateAccount = async (req, res) => {
    try {
        const { loginCode, password, confirmPassword, deviceId } = req.body;

        if (!loginCode || !password || !deviceId) {
            return res.status(400).json({ success: false, message: 'Activation code, password, and device ID are required', data: null, errors: [] });
        }
        if (password.length < 6) {
            return res.status(400).json({ success: false, message: 'Password must be at least 6 characters', data: null, errors: [] });
        }
        if (confirmPassword && password !== confirmPassword) {
            return res.status(400).json({ success: false, message: 'Passwords do not match', data: null, errors: [] });
        }

        // Find user by loginCode (one-time activation code)
        const user = await User.findOne({ loginCode: loginCode.toUpperCase(), isActive: true });
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid activation code', data: null, errors: [] });
        }

        if (user.isPasswordSet) {
            return res.status(400).json({ success: false, message: 'Account already activated. Please login with your password.', data: null, errors: [] });
        }

        // Block activation if the tenant has been deactivated by superadmin
        if (user.tenantId) {
            const userTenant = await Tenant.findById(user.tenantId).select('isActive');
            if (!userTenant || !userTenant.isActive) {
                return res.status(403).json({
                    success: false,
                    message: 'Your account has been suspended. Please contact administrator.',
                    data: null,
                    errors: [],
                });
            }
        }

        // Device lock logic
        if (user.isDeviceLocked && user.deviceId && user.deviceId !== deviceId) {
            return res.status(403).json({ success: false, message: 'Account locked to another device. Ask your admin to reset device lock.', data: null, errors: [] });
        }
        if (!user.isDeviceLocked) {
            user.deviceId = deviceId;
            user.isDeviceLocked = true;
        }

        // Set password and activate
        user.password = password; // bcrypt pre-save hook hashes it
        user.isPasswordSet = true;
        user.loginCode = undefined; // One-time use — invalidate

        // Save password change before issuing tokens (so future permission re-resolve sees fresh state)
        await user.save();

        // Generate tokens (permissions embedded)
        const tokens = await issueAuthTokens(user._id);
        user.refreshToken = tokens.refreshToken;
        await user.save();

        // Fetch tenant
        const tenant = await Tenant.findById(user.tenantId);

        // Find available tenants (same mobileNumber across tenants)
        let availableTenants = [];
        if (user.mobileNumber) {
            const otherUsers = await User.find({ mobileNumber: user.mobileNumber, role: { $in: CUSTOMER_ROLE_VALUES }, isActive: true, deactivatedByCustomer: { $ne: true }, _id: { $ne: user._id } }).select('tenantId');
            const allTenantIds = [user.tenantId, ...otherUsers.map(u => u.tenantId)];
            const tenants = await Tenant.find({ _id: { $in: allTenantIds }, isActive: true }).select('name businessType logo');
            availableTenants = tenants.map(t => ({ id: t._id.toString(), name: t.name, businessType: t.businessType || '', logo: t.logo || '', isCurrent: t._id.toString() === user.tenantId.toString() }));
        }

        logActivity({ req: { ...req, user }, action: 'activate', module: 'auth', description: 'Customer activated account and set password', targetId: user._id, targetName: user.mobileNumber || user.email });
        sessionService.createSession({ userId: user._id, tenantId: user.tenantId, ipAddress: req.ip, deviceInfo: { userAgent: req.headers['user-agent'] }, loginMethod: 'activation' });

        return res.status(200).json({
            success: true,
            message: 'Account activated successfully',
            data: {
                user: transformUserResponse(user, tenant),
                tokens,
                availableTenants: availableTenants.length > 1 ? availableTenants : [],
            },
            errors: [],
        });
    } catch (error) {
        console.error('activateAccount error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to activate account', data: null, errors: [] });
    }
};

// @desc    Update own profile (name, email, mobileNumber)
// @route   POST /api/auth/update-profile
// @access  Private
const updateProfile = async (req, res) => {
    try {
        const { firstName, lastName, email, mobileNumber, password } = req.body;

        // Load user with password field for verification
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found', data: null, errors: [] });
        }

        // Check if sensitive fields (email, mobileNumber) are changing
        const emailChanging = email !== undefined && email.toLowerCase().trim() !== (user.email || '').toLowerCase();
        const mobileChanging = mobileNumber !== undefined && normalizeMobile(mobileNumber) !== (user.mobileNumber || '');

        if (emailChanging || mobileChanging) {
            if (!password) {
                return res.status(400).json({ success: false, message: 'Password is required to change email or mobile number', data: null, errors: [] });
            }
            if (!user.password || !(await user.matchPassword(password))) {
                return res.status(401).json({ success: false, message: 'Password is incorrect', data: null, errors: [] });
            }
        }

        // Uniqueness checks
        if (emailChanging) {
            const emailExists = await User.findOne({ email: email.toLowerCase().trim(), _id: { $ne: user._id } });
            if (emailExists) {
                return res.status(409).json({ success: false, message: 'Email already in use by another account', data: null, errors: [] });
            }
            user.email = email.toLowerCase().trim();
        }

        if (mobileChanging) {
            const normalized = normalizeMobile(mobileNumber);
            const mobileExists = await User.findOne({ mobileNumber: normalized, tenantId: user.tenantId, _id: { $ne: user._id } });
            if (mobileExists) {
                return res.status(409).json({ success: false, message: 'Mobile number already in use by another account in this business', data: null, errors: [] });
            }
            user.mobileNumber = normalized;
        }

        // Update non-sensitive fields
        if (firstName !== undefined) user.firstName = firstName.trim();
        if (lastName !== undefined) user.lastName = lastName.trim();
        if (firstName !== undefined || lastName !== undefined) {
            user.name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
        }

        await user.save();

        const tenant = user.tenantId ? await Tenant.findById(user.tenantId) : null;

        logActivity({ req, action: 'update', module: 'auth', description: 'User updated profile', targetId: user._id, targetName: user.email || user.mobileNumber || user.firstName });

        return res.status(200).json({
            success: true,
            message: 'Profile updated successfully',
            data: { user: transformUserResponse(user, tenant) },
            errors: [],
        });
    } catch (error) {
        console.error('updateProfile error:', error);
        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(409).json({ success: false, message: `${field} already exists`, data: null, errors: [] });
        }
        return res.status(500).json({ success: false, message: error.message || 'Failed to update profile', data: null, errors: [] });
    }
};

// ── Customer multi-owner (business) management ──────────────────────────────

// Build the customer's available businesses (tenants) list, excluding any the
// customer has deactivated. Mirrors the inline builders used by the auth flows.
const buildAvailableTenants = async (user) => {
    if (!CUSTOMER_LIKE.has(user.role) || !user.mobileNumber) return [];
    const accounts = await User.find({
        mobileNumber: user.mobileNumber,
        role: { $in: CUSTOMER_ROLE_VALUES },
        isActive: true,
        deactivatedByCustomer: { $ne: true },
    }).select('tenantId');
    const currentTid = user.tenantId ? user.tenantId.toString() : null;
    const allTenantIds = [...new Set([
        ...(currentTid ? [currentTid] : []),
        ...accounts.map(u => u.tenantId.toString()),
    ])];
    const tenants = await Tenant.find({ _id: { $in: allTenantIds }, isActive: true }).select('name businessType logo');
    return tenants.map(t => ({
        id: t._id.toString(),
        name: t.name,
        businessType: t.businessType || '',
        logo: t.logo || '',
        isCurrent: currentTid ? t._id.toString() === currentTid : false,
    }));
};

// @desc    Add another owner/business to a logged-in customer using its activation code
// @route   POST /api/auth/add-business
// @access  Private (Customer)
const addBusiness = async (req, res) => {
    try {
        const { loginCode, deviceId } = req.body;
        if (!loginCode) {
            return res.status(400).json({ success: false, message: 'Activation code is required', data: null, errors: [] });
        }
        if (!CUSTOMER_LIKE.has(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Only customers can add businesses', data: null, errors: [] });
        }

        // Current user (with password hash, so we can mirror it onto the new account)
        const currentUser = await User.findById(req.user._id);
        if (!currentUser || !currentUser.mobileNumber) {
            return res.status(400).json({ success: false, message: 'Your account has no mobile number on file', data: null, errors: [] });
        }

        // Find target account by its one-time activation code
        const target = await User.findOne({ loginCode: loginCode.toUpperCase(), isActive: true });
        if (!target) {
            return res.status(404).json({ success: false, message: 'Invalid activation code', data: null, errors: [] });
        }

        // Must belong to the same person (same mobile number)
        const sameMobile = normalizeMobile(target.mobileNumber || '') === normalizeMobile(currentUser.mobileNumber || '');
        if (!sameMobile) {
            return res.status(403).json({ success: false, message: 'This activation code is registered to a different mobile number.', data: null, errors: [] });
        }

        if (target.tenantId && currentUser.tenantId && target.tenantId.toString() === currentUser.tenantId.toString()) {
            return res.status(400).json({ success: false, message: 'This is already your current business.', data: null, errors: [] });
        }

        // Target tenant must be active
        const targetTenant = await Tenant.findById(target.tenantId).select('isActive name');
        if (!targetTenant || !targetTenant.isActive) {
            return res.status(403).json({ success: false, message: 'This business is currently unavailable.', data: null, errors: [] });
        }

        // Activate the target account by mirroring the current account's password
        // hash (so the customer uses one password everywhere). updateOne avoids the
        // save() pre-hook re-hashing the already-hashed value.
        await User.updateOne(
            { _id: target._id },
            {
                $set: {
                    password: currentUser.password,
                    isPasswordSet: true,
                    isDeviceLocked: true,
                    deviceId: deviceId || currentUser.deviceId || target.deviceId,
                    deactivatedByCustomer: false,
                    productsHiddenByCustomer: false,
                },
                $unset: { loginCode: '' },
            }
        );

        const availableTenants = await buildAvailableTenants(currentUser);

        logActivity({ req, action: 'add-business', module: 'auth', description: `Customer added business: ${targetTenant.name}`, targetId: target._id, targetName: targetTenant.name });

        return res.status(200).json({
            success: true,
            message: `${targetTenant.name} added to your businesses.`,
            data: { availableTenants },
            errors: [],
        });
    } catch (error) {
        console.error('addBusiness error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to add business', data: null, errors: [] });
    }
};

// @desc    List all businesses (owners) the customer is registered with, incl. hidden/deactivated
// @route   GET /api/auth/my-businesses
// @access  Private (Customer)
const getMyBusinesses = async (req, res) => {
    try {
        if (!CUSTOMER_LIKE.has(req.user.role) || !req.user.mobileNumber) {
            return res.status(200).json({ success: true, data: [], errors: [] });
        }
        const accounts = await User.find({
            mobileNumber: req.user.mobileNumber,
            role: { $in: CUSTOMER_ROLE_VALUES },
            isActive: true,
        }).select('tenantId productsHiddenByCustomer deactivatedByCustomer');

        const tenantIds = [...new Set(accounts.map(a => a.tenantId.toString()))];
        const tenants = await Tenant.find({ _id: { $in: tenantIds }, isActive: true }).select('name businessType logo');
        const tenantMap = {};
        tenants.forEach(t => { tenantMap[t._id.toString()] = t; });

        const currentTid = req.user.tenantId ? req.user.tenantId.toString() : null;
        const businesses = accounts
            .filter(a => tenantMap[a.tenantId.toString()]) // only active tenants
            .map(a => {
                const tid = a.tenantId.toString();
                const t = tenantMap[tid];
                return {
                    tenantId: tid,
                    name: t.name,
                    businessType: t.businessType || '',
                    logo: t.logo || '',
                    isCurrent: tid === currentTid,
                    productsHidden: !!a.productsHiddenByCustomer,
                    deactivated: !!a.deactivatedByCustomer,
                };
            });

        return res.status(200).json({ success: true, data: businesses, errors: [] });
    } catch (error) {
        console.error('getMyBusinesses error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to load businesses', data: null, errors: [] });
    }
};

// Resolve the customer's own account row for a given tenant (same mobile number).
const findCustomerAccountForTenant = (req, tenantId) => User.findOne({
    mobileNumber: req.user.mobileNumber,
    tenantId,
    role: { $in: CUSTOMER_ROLE_VALUES },
    isActive: true,
});

// @desc    Hide/show a given owner's products for the customer
// @route   PUT /api/auth/my-businesses/:tenantId/visibility
// @access  Private (Customer)
const setBusinessVisibility = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { hidden } = req.body;
        const account = await findCustomerAccountForTenant(req, tenantId);
        if (!account) {
            return res.status(404).json({ success: false, message: 'Business not found', data: null, errors: [] });
        }
        account.productsHiddenByCustomer = !!hidden;
        await account.save();
        return res.status(200).json({ success: true, message: hidden ? 'Products hidden' : 'Products visible', data: { tenantId, productsHidden: !!hidden }, errors: [] });
    } catch (error) {
        console.error('setBusinessVisibility error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to update visibility', data: null, errors: [] });
    }
};

// @desc    Deactivate/reactivate an owner relationship; notifies the owner on deactivate
// @route   PUT /api/auth/my-businesses/:tenantId/deactivate
// @access  Private (Customer)
const setBusinessDeactivated = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { deactivated } = req.body;
        const account = await findCustomerAccountForTenant(req, tenantId);
        if (!account) {
            return res.status(404).json({ success: false, message: 'Business not found', data: null, errors: [] });
        }
        const turningOn = !!deactivated && !account.deactivatedByCustomer;
        account.deactivatedByCustomer = !!deactivated;
        await account.save();

        if (turningOn) {
            // Notify the owner that this customer deactivated them.
            const customerName = req.user.name || `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.mobileNumber;
            notifyTenantAdmins({
                tenantId,
                type: NOTIFICATION_TYPES.CUSTOMER_DEACTIVATED,
                title: 'Customer deactivated your business',
                message: `${customerName} has deactivated your business in their app.`,
                data: { customerUserId: account._id.toString(), mobile: req.user.mobileNumber || '' },
            });
        }

        return res.status(200).json({ success: true, message: deactivated ? 'Business deactivated' : 'Business reactivated', data: { tenantId, deactivated: !!deactivated }, errors: [] });
    } catch (error) {
        console.error('setBusinessDeactivated error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Failed to update business', data: null, errors: [] });
    }
};

module.exports = {
    registerAdmin,
    loginUser,
    autoLogin,
    logout,
    refreshAccessToken,
    updatePassword,
    forgotPassword,
    resetPassword,
    createTeamMember,
    loginWithCode,
    generateLoginCode,
    getSystemRoleId,
    createDispatchUser,
    registerPushToken,
    switchTenant,
    sendOtp,
    verifyOtp,
    activateAccount,
    updateProfile,
    addBusiness,
    getMyBusinesses,
    setBusinessVisibility,
    setBusinessDeactivated,
};
