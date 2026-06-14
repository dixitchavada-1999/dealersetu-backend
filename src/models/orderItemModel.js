const mongoose = require('mongoose');

const orderItemSchema = mongoose.Schema(
    {
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'Tenant',
        },
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Order',
            required: true,
        },
        variantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ProductVariant',
        },
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
        },
        // Snapshot fields — saved at order time so history is preserved
        productName: {
            type: String,
        },
        productCode: {
            type: String,
        },
        variantSku: {
            type: String,
        },
        brand: {
            type: String,
        },
        originalPrice: {
            type: Number,
            default: 0,
        },
        discount: {
            type: Number,
            default: 0,
        },
        customerDiscount: {
            type: Number,
            default: 0,
        },
        taxPercentage: {
            type: Number,
            default: 0,
        },
        quantity: {
            type: Number,
            required: true,
            default: 1,
        },
        unit: {
            type: String,
            default: 'Piece',
        },
        pricePerUnit: {
            type: Number,
            required: true,
        },
        totalPrice: {
            type: Number,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

orderItemSchema.index({ orderId: 1 });

module.exports = mongoose.model('OrderItem', orderItemSchema);

