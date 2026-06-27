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
        // Platform branding (used as the default logo across the app + emails).
        // logoUrl     → for DARK backgrounds (landing header, email header).
        // logoLightUrl→ for LIGHT backgrounds (footer, login, register).
        logoUrl: { type: String, default: '' },
        logoLightUrl: { type: String, default: '' },
        brandName: { type: String, default: 'DealerSetu' },
        brandColor: { type: String, default: '#0F52BA' },
    },
    { timestamps: true }
);

// Fetch the singleton, creating it on first access.
platformSettingsSchema.statics.getSettings = async function () {
    let doc = await this.findOne({ key: 'platform' });
    if (!doc) doc = await this.create({ key: 'platform' });
    return doc;
};

const PlatformSettings = mongoose.model('PlatformSettings', platformSettingsSchema);
module.exports = PlatformSettings;
