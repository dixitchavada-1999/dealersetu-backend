const PlatformSettings = require('../models/platformSettingsModel');

// GET /api/platform-settings  — public branding (logo/name/color)
const getPlatformSettings = async (req, res) => {
  try {
    const s = await PlatformSettings.getSettings();
    res.json({
      success: true,
      data: { logoUrl: s.logoUrl || '', logoLightUrl: s.logoLightUrl || '', brandName: s.brandName || 'DealerSetu', brandColor: s.brandColor || '#0F52BA' },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch platform settings' });
  }
};

// PUT /api/platform-settings  — super-admin: update branding
const updatePlatformSettings = async (req, res) => {
  try {
    const s = await PlatformSettings.getSettings();
    const { logoUrl, logoLightUrl, brandName, brandColor } = req.body;
    if (logoUrl !== undefined) s.logoUrl = logoUrl;
    if (logoLightUrl !== undefined) s.logoLightUrl = logoLightUrl;
    if (brandName !== undefined) s.brandName = brandName;
    if (brandColor !== undefined) s.brandColor = brandColor;
    await s.save();
    res.json({
      success: true,
      message: 'Platform settings updated',
      data: { logoUrl: s.logoUrl || '', logoLightUrl: s.logoLightUrl || '', brandName: s.brandName || 'DealerSetu', brandColor: s.brandColor || '#0F52BA' },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to update platform settings' });
  }
};

module.exports = { getPlatformSettings, updatePlatformSettings };
