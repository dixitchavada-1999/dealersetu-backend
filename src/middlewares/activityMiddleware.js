const ActivityLog = require('../models/activityLogModel');

// Map route paths to module names
const getModule = (path) => {
    if (path.includes('/auth')) return 'auth';
    if (path.includes('/orders')) return 'order';
    if (path.includes('/products')) return 'product';
    if (path.includes('/categories')) return 'category';
    if (path.includes('/customers')) return 'customer';
    if (path.includes('/variants')) return 'variant';
    if (path.includes('/feedback')) return 'feedback';
    if (path.includes('/team')) return 'team';
    if (path.includes('/notifications')) return 'notification';
    if (path.includes('/dashboard')) return 'dashboard';
    if (path.includes('/super-admin')) return 'super-admin';
    if (path.includes('/upload')) return 'upload';
    return 'other';
};

// Map HTTP method to action
const getAction = (method, path) => {
    if (path.includes('/login') || path.includes('/auto-login')) return 'login';
    if (path.includes('/logout')) return 'logout';
    if (path.includes('/register')) return 'register';
    if (path.includes('/switch-tenant')) return 'switch_tenant';
    if (path.includes('/place')) return 'place_order';
    if (path.includes('/confirm-delivery')) return 'confirm_delivery';
    if (path.includes('/edit')) return 'edit';
    if (path.includes('/reply')) return 'reply';
    if (path.includes('/restock') || path.includes('/stock')) return 'restock';
    if (path.includes('/toggle-active')) return 'toggle';
    if (path.includes('/permissions')) return 'update_permissions';
    if (path.includes('/reset-device')) return 'reset_device';
    if (path.includes('/mark-read')) return 'mark_read';

    switch (method) {
        case 'POST': return 'create';
        case 'PUT': return 'update';
        case 'PATCH': return 'update';
        case 'DELETE': return 'delete';
        case 'GET': return 'view';
        default: return method.toLowerCase();
    }
};

// Determine log type based on action/module
const getLogType = (action, module, body) => {
    // Critical: delete operations, cancel orders
    if (action === 'delete') return 'critical';
    if (body?.orderStatus === 'Cancelled') return 'warning';

    // Warning: permission changes, discount changes, stock related
    if (action === 'update_permissions') return 'warning';
    if (action === 'reset_device') return 'warning';
    if (action === 'toggle') return 'warning';
    if (body?.discount !== undefined) return 'warning';
    if (body?.commonDiscount !== undefined) return 'warning';

    // Success: create, login, register, order placed, delivered
    if (action === 'create') return 'success';
    if (action === 'register') return 'success';
    if (action === 'place_order') return 'success';
    if (action === 'confirm_delivery') return 'success';
    if (action === 'restock') return 'success';
    if (action === 'reply') return 'success';
    if (body?.orderStatus === 'Delivered') return 'success';
    if (body?.orderStatus === 'Approved') return 'success';

    // Info: login, logout, view, update
    if (action === 'login') return 'info';
    if (action === 'logout') return 'info';
    if (action === 'switch_tenant') return 'info';
    if (action === 'update') return 'info';
    if (action === 'edit') return 'info';

    return 'info';
};

// Build operation code: action_module (e.g., login_admin, create_product, update_order)
const buildOperation = (action, module, role, body) => {
    const roleSuffix = role.toLowerCase();

    // Auth operations
    if (action === 'login') return `login_${roleSuffix}`;
    if (action === 'logout') return `logout_${roleSuffix}`;
    if (action === 'register') return `register_${roleSuffix}`;
    if (action === 'switch_tenant') return `switch_tenant_${roleSuffix}`;

    // Order operations
    if (module === 'order') {
        if (action === 'place_order') return 'place_order';
        if (action === 'confirm_delivery') return 'confirm_delivery';
        if (body?.orderStatus === 'Approved') return 'approve_order';
        if (body?.orderStatus === 'Dispatched') return 'dispatch_order';
        if (body?.orderStatus === 'Delivered') return 'deliver_order';
        if (body?.orderStatus === 'Cancelled') return 'cancel_order';
        if (action === 'edit') return 'edit_order';
        if (body?.paidAmount !== undefined) return 'update_payment';
        return `${action}_order`;
    }

    // Other modules
    return `${action}_${module}`;
};

// Build human-readable description
const buildDescription = (action, module, role, body, url) => {
    const roleName = { ADMIN: 'Admin', USER: 'Customer', DISPATCH: 'Dispatch', PRODUCTION: 'Production', MARKETING: 'Marketing', SUPER_ADMIN: 'Super Admin' }[role] || role;

    // Auth
    if (action === 'login' && body?.loginCode) return `${roleName} logged in with code`;
    if (action === 'login') return `${roleName} logged in${body?.email ? `: ${body.email}` : ''}`;
    if (action === 'logout') return `${roleName} logged out`;
    if (action === 'register') return `${roleName} registered${body?.email ? `: ${body.email}` : ''}`;
    if (action === 'switch_tenant') return `${roleName} switched business`;

    // Order
    if (action === 'place_order') return `${roleName} placed a new order${body?.notes ? ` (${body.notes})` : ''}`;
    if (action === 'confirm_delivery') return `${roleName} confirmed delivery`;
    if (body?.orderStatus === 'Approved') return `${roleName} approved order`;
    if (body?.orderStatus === 'Dispatched') return `${roleName} dispatched order`;
    if (body?.orderStatus === 'Delivered') return `${roleName} marked order as delivered`;
    if (body?.orderStatus === 'Cancelled') return `${roleName} cancelled order`;
    if (action === 'edit' && module === 'order') return `${roleName} edited order`;

    // Product/Category/Customer
    if (body?.name) return `${roleName} ${action === 'create' ? 'created' : action === 'delete' ? 'deleted' : 'updated'} ${module}: ${body.name}`;

    // Variant
    if (module === 'variant' && action === 'restock') return `${roleName} restocked variant${body?.stockQty ? ` to ${body.stockQty}` : ''}`;
    if (module === 'variant') return `${roleName} ${action === 'create' ? 'created' : action === 'delete' ? 'deleted' : 'updated'} variant${body?.sku ? `: ${body.sku}` : ''}`;

    // Feedback
    if (module === 'feedback' && action === 'create') return `${roleName} submitted ${body?.type || ''} feedback${body?.rating ? ` (${body.rating}★)` : ''}`;
    if (module === 'feedback' && action === 'reply') return `${roleName} replied to feedback`;
    if (module === 'feedback' && action === 'delete') return `${roleName} deleted feedback`;

    // Permissions
    if (action === 'update_permissions') return `${roleName} updated ${url.includes('dispatch') ? 'dispatch' : url.includes('production') ? 'production' : 'marketing'} permissions`;

    // Settings
    if (module === 'settings' || module === 'team') return `${roleName} updated ${module} settings`;

    // Generic
    return `${roleName} ${action} ${module}`;
};

// Skip logging for these (too noisy)
const SKIP_PATHS = [
    '/api/notifications/unread-count',
    '/api/dashboard',
    '/health',
];

const SKIP_METHODS = ['GET']; // Only log write operations by default

/**
 * Middleware that logs all non-GET API requests
 * Runs AFTER the response is sent (doesn't slow down the request)
 */
const activityLogger = (req, res, next) => {
    // Skip GET requests and noisy paths
    if (SKIP_METHODS.includes(req.method)) return next();
    if (SKIP_PATHS.some(p => req.originalUrl.includes(p))) return next();

    // Capture original end to log after response
    const originalEnd = res.end;

    res.end = function (...args) {
        originalEnd.apply(this, args);

        // Skip if controller already logged this request with detailed old/new values
        if (req._activityLogged) return;

        // Only log successful operations (2xx status)
        if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
            const module = getModule(req.originalUrl);
            const action = getAction(req.method, req.originalUrl);
            const body = req.body || {};
            const role = req.user.role || 'USER';

            // Build operation code: action_module_role (e.g., login_customer, create_product, update_order)
            const operation = buildOperation(action, module, role, body);

            // Build human-readable description
            const description = buildDescription(action, module, role, body, req.originalUrl);

            // Extract target ID from URL params
            const urlParts = req.originalUrl.split('/');
            const idIndex = urlParts.findIndex(p => p.match(/^[0-9a-fA-F]{24}$/));
            const targetId = idIndex >= 0 ? urlParts[idIndex] : undefined;

            // Auto-assign log type
            const logType = getLogType(action, module, body);

            ActivityLog.create({
                tenantId: req.user.tenantId || null,
                userId: req.user._id,
                userName: `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() || req.user.email || 'User',
                userRole: role,
                action,
                operation,
                logType,
                module,
                description,
                targetId,
                metadata: {
                    method: req.method,
                    path: req.originalUrl,
                    statusCode: res.statusCode,
                    body: action !== 'login' && action !== 'register' ? sanitizeBody(body) : undefined,
                },
                ipAddress: req.ip || req.connection?.remoteAddress,
            }).catch(err => {
                // Never let logging break the app
                console.error('Activity middleware log error:', err.message);
            });
        }
    };

    next();
};

// Remove sensitive fields from body before logging
const sanitizeBody = (body) => {
    const sanitized = { ...body };
    delete sanitized.password;
    delete sanitized.refreshToken;
    delete sanitized.accessToken;
    delete sanitized.token;
    delete sanitized.deviceId;
    // Keep it small
    if (JSON.stringify(sanitized).length > 1000) {
        return { _note: 'Body too large, truncated', keys: Object.keys(sanitized) };
    }
    return sanitized;
};

module.exports = { activityLogger };
