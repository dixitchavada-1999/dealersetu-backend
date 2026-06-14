const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const {
    getVariants,
    getVariantById,
    createVariant,
    updateVariant,
    deleteVariant,
    updateStock,
} = require('../controllers/productVariantController');

router.get('/', protect, requirePermission('variants.read'), getVariants);
router.get('/:id', protect, requirePermission('variants.read'), getVariantById);
router.post('/', protect, requirePermission('variants.create'), createVariant);
router.put('/:id', protect, requirePermission('variants.update'), updateVariant);
router.patch('/:id/stock', protect, requirePermission('variants.updateStock'), updateStock);
router.delete('/:id', protect, requirePermission('variants.delete'), deleteVariant);

module.exports = router;
