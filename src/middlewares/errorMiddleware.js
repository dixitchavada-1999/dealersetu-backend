/**
 * Custom error handler middleware
 * Formats all errors to match frontend expectations
 */
const errorHandler = (err, req, res, next) => {
    // Get status code (default to 500 if not set)
    let statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
    
    // Handle Multer errors
    if (err.name === 'MulterError') {
        statusCode = 400;
        if (err.code === 'LIMIT_FILE_SIZE') {
            err.message = 'File size too large. Maximum size is 5MB.';
        } else if (err.code === 'LIMIT_FILE_COUNT') {
            err.message = 'Too many files. Maximum is 10 images.';
        } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
            err.message = 'Unexpected file field. Use "images" for multiple files or "image" for single file.';
        }
    }
    
    // Handle Cloudinary errors
    if (err.message && (err.message.includes('API key') || err.message.includes('Unknown API key'))) {
        statusCode = 500;
        err.message = 'Cloudinary configuration error: Invalid API key. Please check your CLOUDINARY_API_KEY in .env file. Get credentials from https://cloudinary.com/console';
    } else if (err.message && err.message.includes('cloud_name')) {
        statusCode = 500;
        err.message = 'Cloudinary configuration error: Invalid cloud name. Please check your CLOUDINARY_CLOUD_NAME in .env file.';
    } else if (err.message && err.message.includes('Cloudinary')) {
        statusCode = 500;
    }
    
    // Log error for debugging
    console.error('Error:', {
        message: err.message,
        status: statusCode,
        path: req.path,
        method: req.method,
        errorName: err.name,
    });
    
    // Format response to match frontend expectations
    res.status(statusCode).json({
        success: false,
        message: err.message || 'An error occurred',
        data: null,
        errors: err.errors || [],
        ...(process.env.NODE_ENV === 'development' && { 
            stack: err.stack,
            fullError: err 
        }),
    });
};

/**
 * Not found handler
 */
const notFound = (req, res, next) => {
    const error = new Error(`Route not found - ${req.originalUrl}`);
    res.status(404);
    next(error);
};

module.exports = { errorHandler, notFound };
