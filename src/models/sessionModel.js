const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant' },
    loginAt: { type: Date, required: true, default: Date.now },
    logoutAt: { type: Date },
    duration: { type: Number }, // milliseconds
    deviceInfo: {
        platform: String,
        userAgent: String,
    },
    ipAddress: { type: String },
    loginMethod: { type: String, enum: ['email', 'login_code', 'auto_login', 'switch_tenant'], default: 'email' },
    isActive: { type: Boolean, default: true },
    lastActivityAt: { type: Date, default: Date.now },
}, { timestamps: true });

sessionSchema.index({ userId: 1, isActive: 1 });
sessionSchema.index({ tenantId: 1, createdAt: -1 });
sessionSchema.index({ isActive: 1, lastActivityAt: 1 });

module.exports = mongoose.model('Session', sessionSchema);
