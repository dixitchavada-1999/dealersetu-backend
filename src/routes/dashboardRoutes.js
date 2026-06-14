const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { getDashboardStats } = require('../controllers/dashboardController');

router.get('/', protect, requirePermission('dashboard.read'), getDashboardStats);

module.exports = router;
