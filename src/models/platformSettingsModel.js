const mongoose = require('mongoose');

/**
 * Singleton platform-wide settings (managed by SUPER ADMIN).
 * Identified by the fixed key 'platform'.
 */
const platformSettingsSchema = new mongoose.Schema(
    {
        key: { type: String, default: 'platform', unique: true },
        // Module keys (see config/modules.js) currently marked "under development".
        underDevelopmentModules: { type: [String], default: [] },
    },
    { timestamps: true }
);

const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);
module.exports = PlatformSettings;
