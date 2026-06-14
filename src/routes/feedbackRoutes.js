const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { createFeedback, getMyFeedback, getAllFeedback, getFeedbackByOrder, getFeedbackByProduct, adminReply, deleteFeedback } = require('../controllers/feedbackController');

router.post('/', protect, requirePermission('feedback.create'), createFeedback);
router.get('/my', protect, requirePermission('feedback.read'), getMyFeedback);
router.get('/all', protect, requirePermission('feedback.read'), getAllFeedback);
router.get('/order/:orderId', protect, requirePermission('feedback.read'), getFeedbackByOrder);
router.get('/product/:productId', protect, requirePermission('feedback.read'), getFeedbackByProduct);
router.put('/:id/reply', protect, requirePermission('feedback.reply'), adminReply);
router.delete('/:id', protect, requirePermission('feedback.delete'), deleteFeedback);

module.exports = router;
