const mongoose = require('mongoose');

const apiLogSchema = new mongoose.Schema({
    method: { type: String, required: true },
    path: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    statusCode: { type: Number, required: true },
    responseTime: { type: Number, required: true }, // ms
    requestBody: { type: mongoose.Schema.Types.Mixed },
    responseSize: { type: Number },
    ipAddress: { type: String },
    userAgent: { type: String },
    error: { type: String },
}, { timestamps: true });

apiLogSchema.index({ createdAt: -1 });
apiLogSchema.index({ userId: 1, createdAt: -1 });
apiLogSchema.index({ tenantId: 1, createdAt: -1 });
apiLogSchema.index({ statusCode: 1, createdAt: -1 });
apiLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 }); // 30 day TTL

module.exports = mongoose.model('ApiLog', apiLogSchema);
