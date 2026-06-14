const mongoose = require('mongoose');

const tenantSchema = mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        businessType: {
            type: String,
            trim: true,
        },
        phone: {
            type: String,
            trim: true,
        },
        email: {
            type: String,
            trim: true,
            lowercase: true,
        },
        address: {
            type: String,
            trim: true,
        },
        logo: {
            type: String,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        dispatchPermissions: {
            dashboard: { type: Boolean, default: false },
            categories: { type: Boolean, default: false },
            products: { type: Boolean, default: false },
            orders: { type: Boolean, default: true },
        },
        productionPermissions: {
            dashboard: { type: Boolean, default: false },
            categories: { type: Boolean, default: false },
            products: { type: Boolean, default: false },
            orders: { type: Boolean, default: true },
        },
        marketingPermissions: {
            dashboard: { type: Boolean, default: false },
            categories: { type: Boolean, default: false },
            products: { type: Boolean, default: false },
            orders: { type: Boolean, default: true },
            customers: { type: Boolean, default: false },
        },
        lowStockThreshold: {
            type: Number,
            default: 10,
        },
        defaultRestockQuantity: {
            type: Number,
            default: 50,
            min: 1,
        },
        bannerRotateInterval: {
            type: Number,
            default: 3,
            min: 1,
        },
        themeRotateInterval: {
            type: Number,
            default: 5,
            min: 1,
        },
        exploreGridCols: {
            type: Number,
            default: 3,
            min: 2,
            max: 5,
        },
        exploreGridGap: {
            type: Number,
            default: 1,
            min: 0,
            max: 10,
        },
        exploreImageHeight: {
            type: Number,
            default: 0, // 0 = square (same as width)
        },
        exploreShowTitle: {
            type: Boolean,
            default: true,
        },
        commonDiscount: {
            type: Number,
            default: 0,
            min: 0,
            max: 100,
        },
        notificationsEnabled: {
            type: Boolean,
            default: true,
        },
        notificationPreferences: {
            order_placed: { type: Boolean, default: true },
            order_approved: { type: Boolean, default: true },
            order_dispatched: { type: Boolean, default: true },
            order_delivered: { type: Boolean, default: true },
            order_cancelled: { type: Boolean, default: true },
            payment_received: { type: Boolean, default: true },
            payment_pending: { type: Boolean, default: true },
            new_product: { type: Boolean, default: true },
            new_customer: { type: Boolean, default: true },
            low_stock: { type: Boolean, default: true },
        },
        gstNumber: {
            type: String,
            trim: true,
        },
        udyamNumber: {
            type: String,
            trim: true,
        },
        aadharNumber: {
            type: String,
            trim: true,
        },
        panNumber: {
            type: String,
            trim: true,
            uppercase: true,
        },
        bankDetails: {
            accountNumber: { type: String, trim: true },
            ifscCode: { type: String, trim: true, uppercase: true },
        },
        // Incremented whenever any role's permissions change inside this
        // tenant. JWTs carry the version they were issued under; if the
        // tenant's current version is higher, the token is rejected and the
        // user is forced to re-login so they receive fresh permissions.
        permissionVersion: {
            type: Number,
            default: 0,
        },
        // Slugs of the dynamic (activatable) roles this tenant has switched ON.
        // Owner & Customer are always-on baseline and are NOT listed here.
        // A dynamic role's module only appears in the sidebar when its slug is here.
        enabledRoles: {
            type: [String],
            default: [],
        },
    },
    {
        timestamps: true,
    }
);

const Tenant = mongoose.model('Tenant', tenantSchema);
module.exports = Tenant;
