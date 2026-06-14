const express = require('express');
const router = express.Router();
const {
    getNotifications,
    getUnreadCount,
    markAllAsRead,
    markAsRead,
} = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');

router.use(protect);

router.get('/', requirePermission('notifications.read'), getNotifications);
router.get('/unread-count', requirePermission('notifications.read'), getUnreadCount);
router.put('/read-all', requirePermission('notifications.update'), markAllAsRead);
router.put('/:id/read', requirePermission('notifications.update'), markAsRead);

module.exports = router;
