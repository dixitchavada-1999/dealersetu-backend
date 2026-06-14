const mongoose = require('mongoose');

const orderSchema = mongoose.Schema(
    {
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'Tenant',
        },
        orderNumber: {
            type: String,
            required: true,
            unique: true,
        },
        customerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            required: true,
        },
        orderDate: {
            type: Date,
            default: Date.now,
        },
        totalAmount: {
            type: Number,
            required: true,
            default: 0,
        },
        paidAmount: {
            type: Number,
            default: 0,
        },
        paymentStatus: {
            type: String,
            enum: ['Pending', 'Partial', 'Paid'],
            default: 'Pending',
        },
        orderStatus: {
            type: String,
            enum: ['Placed', 'Approved', 'Dispatched', 'Delivered', 'Cancelled'],
            default: 'Placed',
        },
        notes: {
            type: String,
        },
        deliveryNotes: {
            type: String,
        },
        approvedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        approvedAt: {
            type: Date,
        },
        dispatchedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        dispatchedAt: {
            type: Date,
        },
        deliveredAt: {
            type: Date,
        },
        courierCharge: {
            type: Number,
            default: 0,
        },
        additionalDiscount: {
            type: Number,
            default: 0,
        },
        additionalCharge: {
            type: Number,
            default: 0,
        },
        additionalChargeNote: {
            type: String,
        },
        subtotal: {
            type: Number,
            default: 0,
        },
    },
    {
        timestamps: true,
    }
);

orderSchema.index({ tenantId: 1, createdAt: -1 });
orderSchema.index({ tenantId: 1, customerId: 1 });
orderSchema.index({ tenantId: 1, orderStatus: 1 });

module.exports = mongoose.model('Order', orderSchema);
