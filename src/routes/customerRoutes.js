const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { validateId } = require('../middlewares/validateId');
const {
    getCustomers,
    getCustomerById,
    createCustomer,
    updateCustomer,
    deleteCustomer,
} = require('../controllers/customerController');

router.get('/', protect, requirePermission('customers.read'), getCustomers);
router.get('/:id', protect, validateId(), requirePermission('customers.read'), getCustomerById);
router.post('/', protect, requirePermission('customers.create'), createCustomer);
router.put('/:id', protect, validateId(), requirePermission('customers.update'), updateCustomer);
router.delete('/:id', protect, validateId(), requirePermission('customers.delete'), deleteCustomer);

module.exports = router;
