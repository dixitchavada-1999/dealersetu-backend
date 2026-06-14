// Load environment variables (only in development - Railway uses its own env vars)
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

const http = require('http');
const app = require('./app');
const connectDB = require('./config/db');
const { initializeSocket } = require('./config/socket');

const PORT = process.env.PORT || 3000;

// Connect to Database (non-blocking)
connectDB().catch(err => {
    console.error('⚠️ Database connection failed, but server will continue to run');
    console.error('⚠️ API endpoints will return 503 errors until database is connected');
});

// Create HTTP server and initialize Socket.io
const server = http.createServer(app);
initializeSocket(server);

// Handle EADDRINUSE cleanly — print actionable message instead of crashing nodemon hard.
// (npm run dev also runs `kill-port 3000` before nodemon to prevent this in the first place.)
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} is already in use.`);
        console.error(`   Run "npm run dev" again — the predev script will free the port automatically.`);
        console.error(`   Or manually:  npx kill-port ${PORT}\n`);
        process.exit(1);
    }
    console.error('Server error:', err);
    process.exit(1);
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running in ${process.env.NODE_ENV || 'development'} mode`);
    console.log(`📡 Listening on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    if (process.env.NODE_ENV === 'development') {
        console.log(`📍 Local URL: http://localhost:${PORT}`);
    }
    console.log(`🏥 Health check: http://localhost:${PORT}/health`);

    const { cleanupTimedOutSessions } = require('./services/sessionService');
    const sessionCleanupInterval = setInterval(() => cleanupTimedOutSessions(30), 5 * 60 * 1000); // Every 5 minutes

    // Graceful shutdown — close server, then force-exit after 5s if it hangs
    // (prevents zombie processes that hold port 3000 between nodemon restarts).
    const shutdown = (signal) => {
        console.log(`\n${signal} received — shutting down...`);
        clearInterval(sessionCleanupInterval);
        const forceExit = setTimeout(() => {
            console.error('Force-exit after 5s timeout');
            process.exit(1);
        }, 5000);
        forceExit.unref();
        server.close(() => {
            clearTimeout(forceExit);
            process.exit(0);
        });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err.message || err);
    // Don't exit — log and continue
    // In production, send to error tracking service
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
    process.exit(1);
});
