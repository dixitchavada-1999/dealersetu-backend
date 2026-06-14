const mongoose = require('mongoose');

const customerSchema = mongoose.Schema(
    {
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            ref: 'Tenant',
        },
        name: {
            type: String,
            required: true,
        },
        mobile: {
            type: String,
            required: true,
        },
        email: {
            type: String,
            lowercase: true,
            trim: true,
        },
        shopName: {
            type: String,
        },
        gstNumber: {
            type: String,
            uppercase: true,
            trim: true,
        },
        address: {
            line1: { type: String },
            city: { type: String },
            state: { type: String },
            pincode: { type: String },
        },
        discount: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        outstandingAmount: {
            type: Number,
            default: 0,
        },
        marketingUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
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

customerSchema.index({ tenantId: 1, isActive: 1 });

module.exports = mongoose.model('Customer', customerSchema);

