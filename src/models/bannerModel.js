const mongoose = require('mongoose');

const bannerSchema = new mongoose.Schema({
    tenantId: { type: mongoose.Schema.Types.ObjectId, required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    imageUrl: { type: String, required: true },
    mediaType: { type: String, enum: ['image', 'video'], default: 'image' },
    linkType: { type: String, enum: ['none', 'product', 'category', 'external'], default: 'none' },
    linkId: { type: String }, // productId or categoryId
    linkUrl: { type: String }, // external URL
    isActive: { type: Boolean, default: true },
    priority: { type: Number, default: 0 }, // higher = shown first
    startDate: { type: Date },
    endDate: { type: Date },
}, { timestamps: true });

bannerSchema.index({ tenantId: 1, isActive: 1, priority: -1 });

module.exports = mongoose.model('Banner', bannerSchema);
