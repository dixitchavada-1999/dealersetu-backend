const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { validateId } = require('../middlewares/validateId');
const {
    getCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
} = require('../controllers/categoryController');

router.get('/', protect, requirePermission('categories.read'), getCategories);
router.get('/:id', protect, validateId(), requirePermission('categories.read'), getCategoryById);
router.post('/', protect, requirePermission('categories.create'), createCategory);
router.put('/:id', protect, validateId(), requirePermission('categories.update'), updateCategory);
router.delete('/:id', protect, validateId(), requirePermission('categories.delete'), deleteCategory);

module.exports = router;
