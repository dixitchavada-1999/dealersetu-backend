const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission, requireSuperAdmin } = require('../middlewares/permissionMiddleware');
const {
    getCatalog,
    getRoles,
    getRoleById,
    createRole,
    updateRole,
    deleteRole,
    setRoleActivation,
} = require('../controllers/roleController');

router.use(protect);

// Permission catalog (used by role-editor UI)
router.get('/catalog', requirePermission('roles.read'), getCatalog);

// Read — owners (to view/activate) + super-admin
router.get('/',    requirePermission('roles.read'), getRoles);
router.get('/:id', requirePermission('roles.read'), getRoleById);

// Owner activates / deactivates a dynamic role for their own tenant
router.patch('/:id/activation', requirePermission('roles.read'), setRoleActivation);

// Edit a role's permissions — owners may edit their OWN tenant's (non-system)
// roles; super-admin edits the catalog templates. (Ownership enforced in controller.)
router.put('/:id', requirePermission('roles.update'), updateRole);

// Create / delete role TYPES — SUPER ADMIN only (owners can't add/remove role names)
router.post('/',      requireSuperAdmin, createRole);
router.delete('/:id', requireSuperAdmin, deleteRole);

module.exports = router;
