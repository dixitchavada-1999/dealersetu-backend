const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requireSuperAdmin, requirePermission } = require('../middlewares/permissionMiddleware');
const {
    getDashboard,
    getAllTenants,
    getTenantDetail,
    toggleTenantActive,
    getTenantUsers,
    getTenantCategories,
    getTenantProducts,
    getTenantProductDetail,
    getTenantCustomers,
    getTenantOrders,
    getTenantOrderDetail,
    getActivityLogs,
    getSessions,
    getApiLogs,
} = require('../controllers/superAdminController');

// All super-admin endpoints require authentication AND the SUPER_ADMIN flag.
// Permission checks are layered on top for fine-grained gating.
router.use(protect, requireSuperAdmin);

router.get('/dashboard', getDashboard);

// Tenant management (platform.tenants.*)
router.get('/tenants', requirePermission('tenants.read'), getAllTenants);
router.get('/tenants/:id', requirePermission('tenants.read'), getTenantDetail);
router.patch('/tenants/:id/toggle-active', requirePermission('tenants.toggle'), toggleTenantActive);
router.get('/tenants/:id/users', requirePermission('tenants.read'), getTenantUsers);
router.get('/tenants/:id/categories', requirePermission('tenants.read'), getTenantCategories);
router.get('/tenants/:id/products', requirePermission('tenants.read'), getTenantProducts);
router.get('/tenants/:id/products/:productId', requirePermission('tenants.read'), getTenantProductDetail);
router.get('/tenants/:id/customers', requirePermission('tenants.read'), getTenantCustomers);
router.get('/tenants/:id/orders', requirePermission('tenants.read'), getTenantOrders);
router.get('/tenants/:id/orders/:orderId', requirePermission('tenants.read'), getTenantOrderDetail);

// Activity / sessions / api logs (platform.activitylogs.*)
router.get('/activity-logs', requirePermission('activitylogs.read'), getActivityLogs);
router.get('/sessions', requirePermission('activitylogs.read'), getSessions);
router.get('/api-logs', requirePermission('activitylogs.read'), getApiLogs);

module.exports = router;
