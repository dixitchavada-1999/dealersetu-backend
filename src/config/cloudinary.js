const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const dotenv = require('dotenv');

dotenv.config();

// Validate Cloudinary credentials
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
    console.error('⚠️  Cloudinary credentials are missing!');
    console.error('Please set the following environment variables in your .env file:');
    console.error('  - CLOUDINARY_CLOUD_NAME');
    console.error('  - CLOUDINARY_API_KEY');
    console.error('  - CLOUDINARY_API_SECRET');
    console.error('\nGet your credentials from: https://cloudinary.com/console');
    
    // Don't throw error here, but log warning
    // This allows the app to start but uploads will fail with clear error
}

// Validate that credentials are not placeholder values
if (cloudName && (cloudName === 'your_cloud_name' || cloudName.includes('your_'))) {
    console.warn('⚠️  Cloudinary cloud_name appears to be a placeholder value');
}

if (apiKey && (apiKey === 'your_api_key' || apiKey.includes('your_'))) {
    console.warn('⚠️  Cloudinary API key appears to be a placeholder value');
    throw new Error('Invalid Cloudinary API key. Please set CLOUDINARY_API_KEY in your .env file with your actual Cloudinary API key from https://cloudinary.com/console');
}

if (apiSecret && (apiSecret === 'your_api_secret' || apiSecret.includes('your_'))) {
    console.warn('⚠️  Cloudinary API secret appears to be a placeholder value');
}

// Configure Cloudinary
cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
});

// Build Cloudinary folder path: b2b-app/<tenantId>/<module>
//
// - tenantId: from req.user.tenantId (auth middleware) — falls back to
//   "super-admin" for SUPER_ADMIN users (no tenant) or "shared" if no auth
// - module: from req.body.module / req.query.module — values like
//   "products", "banners", "categories", "users". Defaults to "general"
//   so old callers (no module param) still work.
//
// Allowed module values are whitelisted to prevent path injection
// (e.g. someone passing "../other-tenant" via the module param).
const ALLOWED_MODULES = new Set([
    'products', 'banners', 'categories', 'users', 'variants', 'logos', 'general',
]);

const buildFolderPath = (req) => {
    const tenantId = req.user?.tenantId
        ? String(req.user.tenantId)
        : (req.user?.role === 'SUPER_ADMIN' ? 'super-admin' : 'shared');

    const requestedModule = (req.body?.module || req.query?.module || 'general').toString().toLowerCase();
    const module = ALLOWED_MODULES.has(requestedModule) ? requestedModule : 'general';

    return `b2b-app/${tenantId}/${module}`;
};

// Configure Multer Storage for Cloudinary (dynamic params per request)
let storage;
let videoStorage;
try {
    storage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: async (req, file) => ({
            folder: buildFolderPath(req),
            allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
            transformation: [{ width: 1000, crop: 'limit' }],
        }),
    });

    videoStorage = new CloudinaryStorage({
        cloudinary: cloudinary,
        params: async (req, file) => ({
            // Videos go under <tenantId>/videos regardless of module hint
            folder: `b2b-app/${req.user?.tenantId
                ? String(req.user.tenantId)
                : (req.user?.role === 'SUPER_ADMIN' ? 'super-admin' : 'shared')}/videos`,
            resource_type: 'video',
            allowed_formats: ['mp4', 'webm', 'mov', 'ogg'],
        }),
    });
} catch (error) {
    console.error('❌ Failed to configure Cloudinary storage:', error.message);
    throw error;
}

module.exports = {
    cloudinary,
    storage,
    videoStorage,
};
