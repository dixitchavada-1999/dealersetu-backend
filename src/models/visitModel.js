const mongoose = require('mongoose');

const visitSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    marketingUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Customer info (filled by marketing user)
    customerName: { type: String, required: true, trim: true },
    customerPhone: { type: String, trim: true },
    customerEmail: { type: String, trim: true },
    shopName: { type: String, trim: true },
    address: {
        line1: String,
        city: String,
        state: String,
        pincode: String,
    },
    gstNumber: { type: String, trim: true },
    notes: { type: String, trim: true }, // marketing user's notes about visit
    // Status
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    rejectionReason: { type: String, trim: true },
    // If approved — linked customer + user
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    loginCode: { type: String },
    approvedAt: { type: Date },
    rejectedAt: { type: Date },
}, { timestamps: true });

visitSchema.index({ tenantId: 1, marketingUserId: 1, createdAt: -1 });
visitSchema.index({ tenantId: 1, status: 1 });

module.exports = mongoose.model('Visit', visitSchema);
