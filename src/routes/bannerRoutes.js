const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { requirePermission } = require('../middlewares/permissionMiddleware');
const { getBanners, getBannerById, createBanner, updateBanner, deleteBanner } = require('../controllers/bannerController');

router.get('/', protect, requirePermission('banners.read'), getBanners);
router.get('/:id', protect, requirePermission('banners.read'), getBannerById);
router.post('/', protect, requirePermission('banners.create'), createBanner);
router.put('/:id', protect, requirePermission('banners.update'), updateBanner);
router.delete('/:id', protect, requirePermission('banners.delete'), deleteBanner);

module.exports = router;
