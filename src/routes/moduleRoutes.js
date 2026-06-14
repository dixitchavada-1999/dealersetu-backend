const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requireSuperAdmin } = require('../middlewares/permissionMiddleware');
const { getModules, updateModule } = require('../controllers/moduleController');

// Any authenticated user reads the module catalog (menu + gating).
router.get('/', protect, getModules);
// Only super-admin edits a module (type / under-development).
router.put('/:key', protect, requireSuperAdmin, updateModule);

module.exports = router;
