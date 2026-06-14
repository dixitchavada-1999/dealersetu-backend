const mongoose = require('mongoose');

const roleSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        slug: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
        },
        description: {
            type: String,
            trim: true,
        },
        // System roles (super-admin, owner, customer) are immutable.
        // Only a SUPER_ADMIN may create system roles; UI and APIs reject
        // edits/deletes when isSystemRole === true.
        isSystemRole: {
            type: Boolean,
            default: false,
        },
        // Standard per-tenant roles auto-provisioned for every tenant
        // (Dispatch, Production, Marketing). Editable (permissions) but the
        // role itself cannot be deleted — keeps the fixed role set intact.
        isDefault: {
            type: Boolean,
            default: false,
        },
        // platform = available across all tenants (super-admin templates, customer)
        // tenant   = scoped to a single tenant (owner, custom team roles)
        scope: {
            type: String,
            enum: ['platform', 'tenant'],
            required: true,
        },
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Tenant',
            default: null,
        },
        permissions: {
            type: [String],
            default: [],
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

// Slug must be unique within a tenant. Platform-scope roles (tenantId=null)
// share a single namespace.
roleSchema.index({ tenantId: 1, slug: 1 }, { unique: true });
roleSchema.index({ tenantId: 1, isActive: 1 });

const Role = mongoose.model('Role', roleSchema);
module.exports = Role;
