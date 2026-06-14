const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { createTeamMember, createDispatchUser } = require('../controllers/authController');
const {
    getTeamMembers,
    updateTeamMember,
    deleteTeamMember,
    resetDeviceLock,
    lockDevice,
    getTenantInfo,
    updateTenantInfo,
    getDispatchUsers,
    updateDispatchUser,
    deleteDispatchUser,
    updateDispatchPermissions,
    getProductionUsers,
    createProductionUser,
    updateProductionUser,
    deleteProductionUser,
    updateProductionPermissions,
    getMarketingUsers,
    createMarketingUser,
    updateMarketingUser,
    deleteMarketingUser,
    updateMarketingPermissions,
    getCustomerBalances,
    getSettings,
} = require('../controllers/teamController');

// Settings — any authenticated user can read their own tenant's basic settings
router.get('/settings', protect, getSettings);

// Tenant info — Owner-level (settings module)
router.get('/tenant', protect, requirePermission('settings.read'), getTenantInfo);
router.put('/tenant', protect, requirePermission('settings.update'), updateTenantInfo);

// Customer balances — same scope as customers.read
router.get('/balances', protect, requirePermission('customers.read'), getCustomerBalances);

// Legacy dispatch / production / marketing management — kept under team.* until
// the UI fully transitions to dynamic-role management.
router.get('/dispatch', protect, requirePermission('team.read'), getDispatchUsers);
router.post('/dispatch', protect, requirePermission('team.create'), createDispatchUser);
router.put('/dispatch-permissions', protect, requirePermission('team.update'), updateDispatchPermissions);
router.put('/dispatch/:id', protect, requirePermission('team.update'), updateDispatchUser);
router.delete('/dispatch/:id', protect, requirePermission('team.delete'), deleteDispatchUser);

router.get('/production', protect, requirePermission('team.read'), getProductionUsers);
router.post('/production', protect, requirePermission('team.create'), createProductionUser);
router.put('/production-permissions', protect, requirePermission('team.update'), updateProductionPermissions);
router.put('/production/:id', protect, requirePermission('team.update'), updateProductionUser);
router.delete('/production/:id', protect, requirePermission('team.delete'), deleteProductionUser);

router.get('/marketing', protect, requirePermission('team.read'), getMarketingUsers);
router.post('/marketing', protect, requirePermission('team.create'), createMarketingUser);
router.put('/marketing-permissions', protect, requirePermission('team.update'), updateMarketingPermissions);
router.put('/marketing/:id', protect, requirePermission('team.update'), updateMarketingUser);
router.delete('/marketing/:id', protect, requirePermission('team.delete'), deleteMarketingUser);

// Generic team CRUD
router.get('/', protect, requirePermission('team.read'), getTeamMembers);
router.post('/', protect, requirePermission('team.create'), createTeamMember);
router.put('/:id', protect, requirePermission('team.update'), updateTeamMember);
router.delete('/:id', protect, requirePermission('team.delete'), deleteTeamMember);
router.put('/:id/reset-device', protect, requirePermission('team.update'), resetDeviceLock);
router.put('/:id/lock-device', protect, requirePermission('team.update'), lockDevice);

module.exports = router;
