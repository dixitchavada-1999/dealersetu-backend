const Session = require('../models/sessionModel');

const createSession = async ({ userId, tenantId, ipAddress, deviceInfo, loginMethod }) => {
    try {
        // Close any existing active sessions for this user
        await Session.updateMany(
            { userId, isActive: true },
            { $set: { isActive: false, logoutAt: new Date() } }
        );
        // Calculate duration for closed sessions
        const closedSessions = await Session.find({ userId, logoutAt: { $ne: null }, duration: null });
        for (const s of closedSessions) {
            s.duration = s.logoutAt - s.loginAt;
            await s.save();
        }
        // Create new session
        return await Session.create({ userId, tenantId, ipAddress, deviceInfo, loginMethod });
    } catch (err) {
        console.error('Session create error:', err.message);
    }
};

const closeSession = async (userId) => {
    try {
        const session = await Session.findOne({ userId, isActive: true });
        if (session) {
            session.isActive = false;
            session.logoutAt = new Date();
            session.duration = session.logoutAt - session.loginAt;
            await session.save();
        }
    } catch (err) {
        console.error('Session close error:', err.message);
    }
};

const updateLastActivity = async (userId) => {
    try {
        await Session.updateOne({ userId, isActive: true }, { $set: { lastActivityAt: new Date() } });
    } catch (err) {
        // Silent fail
    }
};

const cleanupTimedOutSessions = async (timeoutMinutes = 30) => {
    try {
        const threshold = new Date(Date.now() - timeoutMinutes * 60 * 1000);
        const stale = await Session.find({ isActive: true, lastActivityAt: { $lt: threshold } });
        for (const s of stale) {
            s.isActive = false;
            s.logoutAt = s.lastActivityAt;
            s.duration = s.logoutAt - s.loginAt;
            await s.save();
        }
        if (stale.length > 0) console.log(`[Session] Cleaned up ${stale.length} timed out sessions`);
    } catch (err) {
        console.error('Session cleanup error:', err.message);
    }
};

module.exports = { createSession, closeSession, updateLastActivity, cleanupTimedOutSessions };
