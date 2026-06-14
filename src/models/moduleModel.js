const mongoose = require('mongoose');

/**
 * A platform feature module (super-admin managed). `type` tells which audience
 * the module belongs to and drives menu visibility:
 *   customer → shown in the customer menu
 *   owner    → shown in the owner/staff menu
 *   both     → shown to both
 */
const moduleSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, trim: true },
        label: { type: String, required: true, trim: true },
        type: { type: String, enum: ['customer', 'owner', 'both'], default: 'both' },
        order: { type: Number, default: 0 },
        // When true, the module still shows in the menu but opens a placeholder.
        underDevelopment: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

const Module = mongoose.model('Module', moduleSchema);
module.exports = Module;
