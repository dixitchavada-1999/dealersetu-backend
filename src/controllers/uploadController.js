const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Use Cloudinary if credentials are provided (works in both dev and production)
// This allows testing Cloudinary in development
let useCloudinary = process.env.CLOUDINARY_CLOUD_NAME &&
                    process.env.CLOUDINARY_API_KEY &&
                    process.env.CLOUDINARY_API_SECRET;

let storage;
let videoStorage;
let upload;
let uploadVideoMw;

if (useCloudinary) {
  // Use Cloudinary storage for production (Railway/Render)
  try {
    const { storage: cloudinaryStorage, videoStorage: cloudinaryVideoStorage } = require('../config/cloudinary');
    storage = cloudinaryStorage;
    videoStorage = cloudinaryVideoStorage;
  } catch (error) {
    console.error('⚠️  Cloudinary not configured, falling back to local storage');
    // Fallback to local storage if Cloudinary fails
    useCloudinary = false;
  }
}

if (!useCloudinary) {
  // Use local disk storage for development
  const uploadsDir = path.join(__dirname, '../uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      const ext = path.extname(file.originalname);
      const name = path.basename(file.originalname, ext);
      cb(null, `${name}-${uniqueSuffix}${ext}`);
    },
  });
  storage = diskStorage;
  videoStorage = diskStorage;
}

upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'));
    }
  },
});

const videoUpload = multer({
  storage: videoStorage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for videos
  },
  fileFilter: (req, file, cb) => {
    const allowedExt = /mp4|webm|mov|ogg|m4v/;
    const extOk = allowedExt.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = /^video\//.test(file.mimetype);
    if (extOk && mimeOk) return cb(null, true);
    cb(new Error('Only video files are allowed (mp4, webm, mov, ogg)'));
  },
});

// @desc    Upload image (Cloudinary in production, local in development)
// @route   POST /api/upload/image
// @access  Private
const uploadImage = async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('No file uploaded');
    }

    let imageUrl;

    if (useCloudinary && req.file.path) {
      // Cloudinary returns the full URL in req.file.path
      // Format: https://res.cloudinary.com/{cloud_name}/image/upload/...
      imageUrl = req.file.path;
      console.log('✅ Image uploaded to Cloudinary:', imageUrl);
    } else if (useCloudinary && req.file.secure_url) {
      // Alternative: Cloudinary might return URL in secure_url
      imageUrl = req.file.secure_url;
      console.log('✅ Image uploaded to Cloudinary (secure_url):', imageUrl);
    } else if (req.file.filename) {
      // Local storage - file is saved locally
      if (process.env.NODE_ENV === 'production') {
        // In production, warn that local storage won't persist
        console.warn('⚠️  Using local storage in production. Files will be lost on restart.');
        console.warn('⚠️  Please configure Cloudinary for persistent file storage.');
      }
      // Generate URL path for the uploaded file
      imageUrl = `/uploads/${req.file.filename}`;
    } else {
      res.status(500);
      throw new Error('Failed to upload image.');
    }

    res.json({
      success: true,
      message: 'Image uploaded successfully',
      data: {
        imageUrl,
        filename: req.file.filename || req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Upload video (Cloudinary in production, local in development)
// @route   POST /api/upload/video
// @access  Private
const uploadVideo = async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400);
      throw new Error('No file uploaded');
    }

    let videoUrl;

    if (useCloudinary && req.file.path) {
      videoUrl = req.file.path;
      console.log('✅ Video uploaded to Cloudinary:', videoUrl);
    } else if (useCloudinary && req.file.secure_url) {
      videoUrl = req.file.secure_url;
    } else if (req.file.filename) {
      if (process.env.NODE_ENV === 'production') {
        console.warn('⚠️  Using local storage for video in production.');
      }
      videoUrl = `/uploads/${req.file.filename}`;
    } else {
      res.status(500);
      throw new Error('Failed to upload video.');
    }

    res.json({
      success: true,
      message: 'Video uploaded successfully',
      data: {
        videoUrl,
        filename: req.file.filename || req.file.originalname,
        size: req.file.size,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Middleware for single image upload
const uploadSingle = upload.single('image');

// Middleware for multiple image uploads
const uploadMultiple = upload.array('images', 10); // Max 10 images

// Middleware for single video upload
const uploadVideoSingle = videoUpload.single('video');

module.exports = {
  uploadImage,
  uploadVideo,
  uploadSingle,
  uploadMultiple,
  uploadVideoSingle,
};

