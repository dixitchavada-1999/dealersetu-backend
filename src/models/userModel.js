const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = mongoose.Schema(
    {
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Tenant',
            required: function() { return this.role !== 'SUPER_ADMIN'; },
        },
        loginCode: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
        },
        isDeviceLocked: {
            type: Boolean,
            default: false,
        },
        name: {
            type: String,
            required: false, // Keep for backward compatibility
        },
        firstName: {
            type: String,
            required: function() {
                return !this.name; // Required if name is not provided
            },
        },
        lastName: {
            type: String,
            required: function() {
                return !this.name;
            },
        },
        userName: {
            type: String,
            sparse: true,
            trim: true,
        },
        email: {
            type: String,
            sparse: true,
            lowercase: true,
            trim: true,
        },
        mobileNumber: {
            type: String,
            trim: true,
        },
        password: {
            type: String,
        },
        isPasswordSet: {
            type: Boolean,
            default: false,
        },
        // ── Legacy role field — kept for backward compatibility during the
        // RBAC transition. Source of truth is `roleId` below. Once all
        // controllers are refactored to use permissions, this field will be
        // removed. New roles: SUPER_ADMIN, OWNER, CUSTOMER, CUSTOM.
        role: {
            type: String,
            required: true,
            enum: [
                // New roles
                'SUPER_ADMIN', 'OWNER', 'CUSTOMER', 'CUSTOM',
                // Legacy roles (kept so existing data validates until migration runs)
                'ADMIN', 'USER', 'DISPATCH', 'PRODUCTION', 'MARKETING',
            ],
            default: 'CUSTOMER',
        },
        // ── Dynamic RBAC ──
        roleId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Role',
            // Optional during the transition. After migration, application
            // logic enforces presence on every new user.
        },
        permissionOverrides: {
            // Permissions added on top of the role's default set
            grant: { type: [String], default: [] },
            // Permissions removed from the role's set (explicit deny wins)
            revoke: { type: [String], default: [] },
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        shopName: {
            type: String,
            trim: true,
        },
        gstNumber: {
            type: String,
            trim: true,
        },
        address: {
            line1: { type: String, trim: true },
            city: { type: String, trim: true },
            state: { type: String, trim: true },
            pincode: { type: String, trim: true },
        },
        linkedCustomerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
        },
        // Customer-controlled (per owner/tenant) relationship flags.
        // Set on the customer's User record for a given tenant.
        productsHiddenByCustomer: {
            type: Boolean,
            default: false,
        },
        deactivatedByCustomer: {
            type: Boolean,
            default: false,
        },
        deviceId: {
            type: String,
            trim: true,
        },
        expoPushToken: {
            type: String,
        },
        refreshToken: {
            type: String,
        },
        resetPasswordToken: {
            type: String,
        },
        resetPasswordExpires: {
            type: Date,
        },
    },
    {
        timestamps: true,
        // Defense-in-depth: never serialize secrets, even if a controller
        // accidentally sends a raw user document. (Internal property access
        // like user.password for matchPassword still works.)
        toJSON: {
            transform(_doc, ret) {
                delete ret.password;
                delete ret.refreshToken;
                delete ret.resetPasswordToken;
                delete ret.resetPasswordExpires;
                return ret;
            },
        },
    }
);

// Per-tenant uniqueness: same email/userName/mobileNumber may exist
// across different tenants (multi-tenant customer scenario), but must be
// unique within a single tenant. SUPER_ADMIN has no tenantId so the
// partial filter excludes it from these compound indexes.
userSchema.index(
    { tenantId: 1, email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: 'string' }, tenantId: { $type: 'objectId' } } }
);
userSchema.index(
    { tenantId: 1, userName: 1 },
    { unique: true, partialFilterExpression: { userName: { $type: 'string' }, tenantId: { $type: 'objectId' } } }
);
userSchema.index(
    { tenantId: 1, mobileNumber: 1 },
    { unique: true, partialFilterExpression: { mobileNumber: { $type: 'string' }, tenantId: { $type: 'objectId' } } }
);

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Encrypt password using bcrypt before saving
userSchema.pre('save', async function () {
    // Only hash password if it has been modified
    if (!this.isModified('password')) {
        return;  // Skip hashing
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model('User', userSchema);
module.exports = User;
