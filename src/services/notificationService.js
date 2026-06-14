const Notification = require('../models/notificationModel');
const User = require('../models/userModel');
const Tenant = require('../models/tenantModel');
const { Expo } = require('expo-server-sdk');
const { OWNER_ROLE_VALUES, findTenantUserIdsByPermission } = require('../config/roleValues');

let getIO;
try {
    getIO = require('../config/socket').getIO;
} catch (e) {
    // Socket not initialized yet
}

const expo = new Expo();

/**
 * Send Expo push notification (fire-and-forget)
 */
const sendPushNotification = async (expoPushToken, title, message, data) => {
    try {
        if (!expoPushToken || !Expo.isExpoPushToken(expoPushToken)) {
            return;
        }

        const messages = [{
            to: expoPushToken,
            sound: 'default',
            title,
            body: message,
            data: data || {},
        }];

        await expo.sendPushNotificationsAsync(messages);
    } catch (error) {
        console.error('Push notification error:', error.message);
    }
};

/**
 * Check if notifications are enabled for a tenant.
 * Returns true if enabled or if tenant not found (safe default).
 */
const isNotificationsEnabled = async (tenantId, type) => {
    try {
        const tenant = await Tenant.findById(tenantId).select('notificationsEnabled notificationPreferences');
        if (tenant && tenant.notificationsEnabled === false) {
            return false;
        }
        // Check per-type preference
        if (type && tenant?.notificationPreferences) {
            const pref = tenant.notificationPreferences[type];
            if (pref === false) return false;
        }
        return true;
    } catch (error) {
        console.error('Notifications enabled check failed:', error.message);
        return true;
    }
};

/**
 * Create a notification, emit via Socket.io, and send push
 * All fire-and-forget — errors never break the main operation
 */
const createNotification = async ({ tenantId, recipientId, type, title, message, data }) => {
    try {
        const notification = await Notification.create({
            tenantId,
            recipientId,
            type,
            title,
            message,
            data: data || {},
        });

        // Emit via Socket.io
        try {
            const io = getIO();
            io.to(`user:${recipientId}`).emit('notification', {
                _id: notification._id,
                type: notification.type,
                title: notification.title,
                message: notification.message,
                data: notification.data,
                isRead: notification.isRead,
                createdAt: notification.createdAt,
            });
        } catch (socketErr) {
            // Socket may not be initialized
        }

        // Send push notification
        try {
            const user = await User.findById(recipientId).select('expoPushToken');
            if (user?.expoPushToken) {
                sendPushNotification(user.expoPushToken, title, message, data);
            }
        } catch (pushErr) {
            // Push errors should never break flow
        }

        return notification;
    } catch (error) {
        console.error('Create notification error:', error.message);
    }
};

/**
 * Notify all active admins in a tenant
 */
const notifyTenantAdmins = async ({ tenantId, type, title, message, data }) => {
    try {
        // Check if notifications are enabled (single check for all admins)
        const enabled = await isNotificationsEnabled(tenantId, type);
        if (!enabled) return;

        const admins = await User.find({
            tenantId,
            role: { $in: OWNER_ROLE_VALUES },
            isActive: true,
        }).select('_id');

        for (const admin of admins) {
            createNotification({
                tenantId,
                recipientId: admin._id,
                type,
                title,
                message,
                data,
            });
        }
    } catch (error) {
        console.error('Notify tenant admins error:', error.message);
    }
};

/**
 * Notify all active dispatch users in a tenant
 */
const notifyTenantDispatch = async ({ tenantId, type, title, message, data }) => {
    try {
        // Check if notifications are enabled (single check for all dispatchers)
        const enabled = await isNotificationsEnabled(tenantId, type);
        if (!enabled) return;

        // Dynamic: anyone whose role can dispatch orders (replaces the legacy
        // hardcoded 'DISPATCH' role).
        const dispatcherIds = await findTenantUserIdsByPermission(tenantId, 'orders.dispatch');

        for (const dispatcherId of dispatcherIds) {
            createNotification({
                tenantId,
                recipientId: dispatcherId,
                type,
                title,
                message,
                data,
            });
        }
    } catch (error) {
        console.error('Notify tenant dispatch error:', error.message);
    }
};

/**
 * Notify all active production users in a tenant
 */
const notifyTenantProduction = async ({ tenantId, type, title, message, data }) => {
    try {
        // Check if notifications are enabled (single check for all production users)
        const enabled = await isNotificationsEnabled(tenantId, type);
        if (!enabled) return;

        const productionUsers = await User.find({
            tenantId,
            role: 'PRODUCTION',
            isActive: true,
        }).select('_id');

        for (const user of productionUsers) {
            createNotification({
                tenantId,
                recipientId: user._id,
                type,
                title,
                message,
                data,
            });
        }
    } catch (error) {
        console.error('Notify tenant production error:', error.message);
    }
};

/**
 * Find a User account linked to a given customerId within a tenant
 */
const findUserByCustomerId = async (tenantId, customerId) => {
    try {
        return await User.findOne({
            tenantId,
            linkedCustomerId: customerId,
            isActive: true,
        }).select('_id');
    } catch (error) {
        console.error('Find user by customerId error:', error.message);
        return null;
    }
};

module.exports = {
    createNotification,
    notifyTenantAdmins,
    notifyTenantDispatch,
    notifyTenantProduction,
    findUserByCustomerId,
};
