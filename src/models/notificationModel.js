const mongoose = require('mongoose');
const { NOTIFICATION_TYPE_VALUES } = require('../constants/notificationTypes');

const notificationSchema = mongoose.Schema(
    {
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Tenant',
            required: true,
        },
        recipientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        type: {
            type: String,
            required: true,
            enum: NOTIFICATION_TYPE_VALUES,
        },
        title: {
            type: String,
            required: true,
        },
        message: {
            type: String,
            required: true,
        },
        data: {
            orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
            customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
            productVariantId: { type: mongoose.Schema.Types.ObjectId, ref: 'ProductVariant' },
            orderNumber: String,
            amount: Number,
        },
        isRead: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index for efficient querying
notificationSchema.index({ recipientId: 1, isRead: 1, createdAt: -1 });

// TTL index: auto-delete after 90 days
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const Notification = mongoose.model('Notification', notificationSchema);
module.exports = Notification;
