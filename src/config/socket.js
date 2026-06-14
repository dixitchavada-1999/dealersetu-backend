const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io;

/**
 * Initialize Socket.io with JWT auth middleware
 */
const initializeSocket = (httpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: process.env.NODE_ENV === 'production'
                ? (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean)
                : '*',
            methods: ['GET', 'POST'],
            credentials: true,
        },
    });

    // JWT authentication middleware
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication token required'));
        }
        try {
            const decoded = jwt.decode(token);
            if (!decoded || !decoded.id) {
                return next(new Error('Invalid authentication token'));
            }
            const secret = process.env.JWT_SECRET + decoded.id.toString();
            const verified = jwt.verify(token, secret);
            socket.userId = verified.id;
            socket.tenantId = verified.tenantId;
            socket.userRole = verified.role;
            next();
        } catch (err) {
            next(new Error('Invalid authentication token'));
        }
    });

    io.on('connection', (socket) => {
        // Join user-specific room for targeted delivery
        socket.join(`user:${socket.userId}`);

        // Join tenant room for broadcast
        if (socket.tenantId) {
            socket.join(`tenant:${socket.tenantId}`);
        }

        socket.on('disconnect', () => {
            // Cleanup handled automatically by Socket.io
        });
    });

    console.log('🔌 Socket.io initialized');
    return io;
};

/**
 * Get the Socket.io instance
 */
const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized. Call initializeSocket first.');
    }
    return io;
};

module.exports = { initializeSocket, getIO };
