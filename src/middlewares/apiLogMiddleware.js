const ApiLog = require('../models/apiLogModel');

const SKIP_PATHS = ['/health', '/api/notifications/unread-count'];

const sanitizeBody = (body) => {
    if (!body || typeof body !== 'object') return undefined;
    const s = { ...body };
    delete s.password; delete s.refreshToken; delete s.accessToken; delete s.token;
    const str = JSON.stringify(s);
    if (str.length > 1000) return { _truncated: true, keys: Object.keys(s) };
    return s;
};

const apiLogMiddleware = (req, res, next) => {
    if (SKIP_PATHS.some(p => req.originalUrl.includes(p))) return next();

    const startTime = Date.now();
    const originalEnd = res.end;

    res.end = function (...args) {
        originalEnd.apply(this, args);
        const responseTime = Date.now() - startTime;

        ApiLog.create({
            method: req.method,
            path: req.originalUrl,
            userId: req.user?._id || null,
            tenantId: req.user?.tenantId || null,
            statusCode: res.statusCode,
            responseTime,
            requestBody: req.method !== 'GET' ? sanitizeBody(req.body) : undefined,
            responseSize: res.getHeader('content-length') ? Number(res.getHeader('content-length')) : undefined,
            ipAddress: req.ip || req.connection?.remoteAddress,
            userAgent: req.headers['user-agent'],
            error: res.statusCode >= 400 ? `${res.statusCode} error` : undefined,
        }).catch(err => console.error('API log error:', err.message));
    };

    next();
};

module.exports = { apiLogMiddleware };
