const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['order', 'product', 'general'], required: true },
    // For order feedback
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    // For product feedback
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true },
    // Admin response
    adminReply: { type: String, trim: true },
    adminRepliedAt: { type: Date },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Performance indexes (not unique - duplicates handled in controller)
feedbackSchema.index({ tenantId: 1, type: 1 });
feedbackSchema.index({ tenantId: 1, orderId: 1 });
feedbackSchema.index({ tenantId: 1, productId: 1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
