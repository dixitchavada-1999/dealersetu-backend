const ActivityLog = require('../models/activityLogModel');

const logActivity = async ({ req, action, module, description, targetId, targetName, metadata }) => {
    try {
        await ActivityLog.create({
            tenantId: req.user?.tenantId || null,
            userId: req.user?._id,
            userName: req.user ? `${req.user.firstName || ''} ${req.user.lastName || ''}`.trim() : 'System',
            userRole: req.user?.role || 'SYSTEM',
            action,
            module,
            description,
            targetId: targetId?.toString(),
            targetName,
            metadata,
            ipAddress: req.ip || req.connection?.remoteAddress,
        });
        // Flag so the activity middleware doesn't duplicate this log
        req._activityLogged = true;
    } catch (error) {
        console.error('Activity log error:', error.message);
    }
};

module.exports = { logActivity };
