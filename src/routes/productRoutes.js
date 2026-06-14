const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { validateId } = require('../middlewares/validateId');
const {
    getProducts,
    getMyPurchasedProducts,
    getMyPurchasedVariants,
    getProductById,
    createProduct,
    updateProduct,
    deleteProduct,
} = require('../controllers/productController');
const { uploadMultiple } = require('../controllers/uploadController');

const handleMulterUpload = (req, res, next) => {
    uploadMultiple(req, res, (err) => {
        if (err) return next(err);
        next();
    });
};

router.get('/', protect, requirePermission('products.read'), getProducts);
// Static path must be registered before '/:id' so it isn't captured as an id.
router.get('/my-purchased', protect, requirePermission('products.read'), getMyPurchasedProducts);
router.get('/:id', protect, validateId(), requirePermission('products.read'), getProductById);
router.get('/:id/my-purchased-variants', protect, validateId(), requirePermission('products.read'), getMyPurchasedVariants);
router.post('/', protect, requirePermission('products.create'), handleMulterUpload, createProduct);
router.put('/:id', protect, validateId(), requirePermission('products.update'), handleMulterUpload, updateProduct);
router.delete('/:id', protect, validateId(), requirePermission('products.delete'), deleteProduct);

module.exports = router;
