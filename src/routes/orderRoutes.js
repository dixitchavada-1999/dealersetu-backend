const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middlewares/permissionMiddleware');
const { validateId } = require('../middlewares/validateId');
const {
    getOrders,
    getOrderById,
    createOrder,
    updateOrder,
    deleteOrder,
    permanentDeleteOrder,
    placeOrder,
    placeMultiOrder,
    confirmDelivery,
    editOrder,
} = require('../controllers/orderController');

// Permission-aware PUT /:id middleware:
//   - orders.update           → unrestricted update
//   - orders.dispatch         → may set orderStatus to "Dispatched" + deliveryNotes
//   - orders.deliver          → may set orderStatus to "Delivered" + deliveryNotes
//   - none of the above       → 403
const allowOrderUpdate = (req, res, next) => {
    const perms = req.user?.permissions || [];
    if (perms.includes('orders.update')) return next();

    const canDispatch = perms.includes('orders.dispatch');
    const canDeliver = perms.includes('orders.deliver');
    if (!canDispatch && !canDeliver) {
        return res.status(403).json({ success: false, message: 'Permission denied: orders.update' });
    }

    const allowedFields = ['orderStatus', 'deliveryNotes'];
    const bodyKeys = Object.keys(req.body || {});
    const hasDisallowed = bodyKeys.some((k) => !allowedFields.includes(k));
    if (hasDisallowed) {
        return res.status(403).json({ success: false, message: 'Only orderStatus and deliveryNotes are allowed' });
    }

    const status = req.body.orderStatus;
    if (status) {
        if (status === 'Dispatched' && !canDispatch) {
            return res.status(403).json({ success: false, message: 'Permission denied: orders.dispatch' });
        }
        if (status === 'Delivered' && !canDeliver) {
            return res.status(403).json({ success: false, message: 'Permission denied: orders.deliver' });
        }
        if (status !== 'Dispatched' && status !== 'Delivered') {
            return res.status(403).json({ success: false, message: 'Status must be Dispatched or Delivered' });
        }
    }
    next();
};

router.post('/place', protect, requirePermission('orders.create'), placeOrder);
router.post('/place-multi', protect, requirePermission('orders.create'), placeMultiOrder);

// Customer-side confirm-delivery — controller validates ownership.
router.put('/:id/confirm-delivery', protect, validateId(), requirePermission('orders.read'), confirmDelivery);

router.put('/:id/edit', protect, validateId(), requirePermission('orders.update'), editOrder);

router.get('/', protect, requirePermission('orders.read'), getOrders);
router.get('/:id', protect, validateId(), requirePermission('orders.read'), getOrderById);

router.post('/', protect, requirePermission('orders.create'), createOrder);
router.put('/:id', protect, validateId(), allowOrderUpdate, updateOrder);
router.delete('/:id', protect, validateId(), requirePermission('orders.delete'), deleteOrder);
router.delete('/:id/permanent', protect, validateId(), requirePermission('orders.delete'), permanentDeleteOrder);

module.exports = router;
