const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String },
    userRole: { type: String },
    action: { type: String, required: true },
    operation: { type: String }, // e.g., login_admin, create_product, approve_order
    logType: { type: String, enum: ['info', 'success', 'warning', 'error', 'critical'], default: 'info' },
    module: { type: String, required: true },
    description: { type: String, required: true },
    targetId: { type: String },
    targetName: { type: String },
    metadata: { type: mongoose.Schema.Types.Mixed },
    ipAddress: { type: String },
}, { timestamps: true });

activityLogSchema.index({ tenantId: 1, createdAt: -1 });
activityLogSchema.index({ userId: 1, createdAt: -1 });
activityLogSchema.index({ module: 1, action: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
