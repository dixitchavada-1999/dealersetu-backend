const mongoose = require('mongoose');

const categorySchema = mongoose.Schema(
    {
        tenantId: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        name: {
            type: String,
            required: true,
        },
        description: {
            type: String,
        },
        imageUrl: {
            type: String,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        variantAttributes: [{
            name: { type: String, required: true },
            values: [{ type: String }],
        }],
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('Category', categorySchema);
