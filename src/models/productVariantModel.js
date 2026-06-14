const mongoose = require('mongoose');

const productVariantSchema = mongoose.Schema(
    {
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'Tenant',
        },
        productId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true,
        },
        sku: {
            type: String,
            required: true,
            unique: true,
        },
        price: {
            type: Number,
            required: true,
        },
        costPrice: {
            type: Number,
        },
        taxPercentage: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        finalPrice: {
            type: Number,
            required: true,
        },
        stockQty: {
            type: Number,
            required: true,
            default: 0,
        },
        unit: {
            type: String,
            enum: ['Piece', 'Kg', 'Gram', 'Liter', 'Meter', 'Box', 'Dozen', 'Set', 'Pair'],
            default: 'Piece',
        },
        weight: {
            type: Number,
        },
        dimensions: {
            type: String,
        },
        attributes: {
            type: Object,
            default: {},
        },
        images: [{
            type: String,
        }],
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

// Calculate final price before validation
// If variant has its own tax, use it; otherwise product-level tax is applied via controller
productVariantSchema.pre('validate', function () {
    if (this.price != null) {
        const taxAmount = (this.price * (this.taxPercentage || 0)) / 100;
        this.finalPrice = Math.round((this.price + taxAmount) * 100) / 100;
    }
});

productVariantSchema.index({ productId: 1 });
productVariantSchema.index({ tenantId: 1, isActive: 1 });

module.exports = mongoose.model('ProductVariant', productVariantSchema);
