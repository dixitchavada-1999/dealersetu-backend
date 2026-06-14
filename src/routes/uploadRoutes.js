const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { uploadImage, uploadVideo, uploadSingle, uploadVideoSingle } = require('../controllers/uploadController');

// @route   POST /api/upload/image
// @desc    Upload image file
// @access  Private
router.post('/image', protect, uploadSingle, uploadImage);

// @route   POST /api/upload/video
// @desc    Upload video file
// @access  Private
router.post('/video', protect, uploadVideoSingle, uploadVideo);

module.exports = router;

