const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { errorHandler, notFound } = require('./middlewares/errorMiddleware');

const app = express();

// CORS Configuration - Allow all origins in development, specific in production
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // In production, you can specify allowed origins
    const allowedOrigins = process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : (process.env.NODE_ENV === 'development' ? ['*'] : []);
    
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

// Rate limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per window
    message: { success: false, message: 'Too many attempts. Please try again after 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { success: false, message: 'Too many requests. Please slow down.' },
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cors(corsOptions));
app.use(helmet());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Apply rate limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login-code', authLimiter);
app.use('/api/auth/send-otp', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth/activate-account', authLimiter);
app.use('/api/auth/refresh-token', authLimiter);
app.use('/api', apiLimiter);

// Serve static files from uploads directory (only in development)
// Note: In production (Railway/Render), use Cloudinary for file storage
// Railway has ephemeral filesystem - files are lost on restart
if (process.env.NODE_ENV === 'development') {
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
} else {
    // In production, serve a message that files should be uploaded to Cloudinary
    app.use('/uploads', (req, res) => {
        res.status(404).json({
            success: false,
            message: 'File not found. In production, files are stored in Cloudinary.',
        });
    });
}

// Activity logging middleware (logs all write operations)
const { activityLogger } = require('./middlewares/activityMiddleware');
app.use('/api', activityLogger);

// API response logging middleware
const { apiLogMiddleware } = require('./middlewares/apiLogMiddleware');
app.use('/api', apiLogMiddleware);

// Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/team', require('./routes/teamRoutes'));
app.use('/api/modules', require('./routes/moduleRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/products', require('./routes/productRoutes'));
app.use('/api/variants', require('./routes/productVariantRoutes'));
app.use('/api/customers', require('./routes/customerRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/upload', require('./routes/uploadRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/super-admin/email-templates', require('./routes/emailTemplateRoutes'));
app.use('/api/super-admin', require('./routes/superAdminRoutes'));
app.use('/api/feedback', require('./routes/feedbackRoutes'));
app.use('/api/banners', require('./routes/bannerRoutes'));
app.use('/api/visits', require('./routes/visitRoutes'));
app.use('/api/roles', require('./routes/roleRoutes'));

// Health check endpoint
app.get('/health', (req, res) => {
    const mongoose = require('mongoose');
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.status(dbStatus === 'connected' ? 200 : 503).json({
        success: dbStatus === 'connected',
        message: dbStatus === 'connected' ? 'API is healthy' : 'API is running but database is disconnected',
        version: '1.0.0',
        database: dbStatus,
        timestamp: new Date().toISOString(),
    });
});

// Basic route
app.get('/', (req, res) => {
    const mongoose = require('mongoose');
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    res.json({
        success: true,
        message: 'DealerSetu API is running',
        version: '1.0.0',
        database: dbStatus,
        endpoints: {
            auth: '/api/auth',
            team: '/api/team',
            categories: '/api/categories',
            products: '/api/products',
            variants: '/api/variants',
            customers: '/api/customers',
            orders: '/api/orders',
            dashboard: '/api/dashboard',
            feedback: '/api/feedback',
            health: '/health',
        },
    });
});

// 404 handler (must be before error handler)
app.use(notFound);

// Error handling middleware (must be last)
app.use(errorHandler);

module.exports = app;
