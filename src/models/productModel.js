const mongoose = require('mongoose');

const productSchema = mongoose.Schema(
    {
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'Tenant',
        },
        categoryId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Category',
            required: true,
        },
        name: {
            type: String,
            required: true,
        },
        productCode: {
            type: String,
            unique: true,
            sparse: true,
        },
        description: {
            type: String,
        },
        brand: {
            type: String,
        },
        costPrice: {
            type: Number,
        },
        variantAttributes: [{
            name: { type: String, required: true },
            values: [{ type: String }],
        }],
        unit: {
            type: String,
            enum: ['Piece', 'Kg', 'Gram', 'Liter', 'Meter', 'Box', 'Dozen', 'Set', 'Pair'],
            default: 'Piece',
        },
        imageUrl: {
            type: String,
        },
        imageUrls: {
            type: [String],
            default: [],
        },
        taxPercentage: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        discount: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        averageRating: {
            type: Number,
            default: 0,
        },
        ratingCount: {
            type: Number,
            default: 0,
        },
        hasVariants: {
            type: Boolean,
            default: true,
        },
        price: {
            type: Number,
        },
        finalPrice: {
            type: Number,
        },
        stockQty: {
            type: Number,
            default: 0,
        },
        sku: {
            type: String,
            trim: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

productSchema.pre('validate', function() {
    if (!this.hasVariants && this.price != null) {
        const taxAmount = (this.price * (this.taxPercentage || 0)) / 100;
        this.finalPrice = Math.round((this.price + taxAmount) * 100) / 100;
    }
});

productSchema.index({ tenantId: 1, isActive: 1 });
productSchema.index({ tenantId: 1, categoryId: 1 });

module.exports = mongoose.model('Product', productSchema);
