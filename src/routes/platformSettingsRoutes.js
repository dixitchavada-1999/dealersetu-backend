const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requireSuperAdmin } = require('../middlewares/permissionMiddleware');
const { getPlatformSettings, updatePlatformSettings } = require('../controllers/platformSettingsController');

// Public read (so the logo can be shown on login etc.); super-admin write.
router.get('/', getPlatformSettings);
router.put('/', protect, requireSuperAdmin, updatePlatformSettings);

module.exports = router;
