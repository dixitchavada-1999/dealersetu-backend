const Module = require('../models/moduleModel');
const { logActivity } = require('../utils/activityLogger');

// @desc    List feature modules (clients use this for menu + gating)
// @route   GET /api/modules
// @access  Private (any authenticated user)
const getModules = async (req, res, next) => {
    try {
        const modules = await Module.find({ isActive: true }).sort({ order: 1, label: 1 }).lean();
        res.json({
            success: true,
            data: {
                modules: modules.map((m) => ({
                    key: m.key,
                    label: m.label,
                    type: m.type,
                    order: m.order,
                    underDevelopment: !!m.underDevelopment,
                })),
                // Back-compat for the under-development gate.
                underDevelopment: modules.filter((m) => m.underDevelopment).map((m) => m.key),
            },
        });
    } catch (err) { next(err); }
};

// @desc    Update a module (type / under-development / label / order)
// @route   PUT /api/modules/:key
// @access  Private (super-admin)
const updateModule = async (req, res, next) => {
    try {
        const mod = await Module.findOne({ key: req.params.key });
        if (!mod) return res.status(404).json({ success: false, message: 'Module not found' });

        const { type, underDevelopment, label, order, isActive } = req.body;
        if (type !== undefined) {
            if (!['customer', 'owner', 'both'].includes(type)) {
                return res.status(400).json({ success: false, message: 'type must be customer, owner or both' });
            }
            mod.type = type;
        }
        if (underDevelopment !== undefined) mod.underDevelopment = !!underDevelopment;
        if (label !== undefined && label.trim()) mod.label = label.trim();
        if (order !== undefined) mod.order = order;
        if (isActive !== undefined) mod.isActive = !!isActive;
        await mod.save();

        logActivity({ req, action: 'update', module: 'settings', description: `Module "${mod.key}" updated (type=${mod.type}, underDev=${mod.underDevelopment})`, targetName: mod.key });

        res.json({ success: true, data: { key: mod.key, label: mod.label, type: mod.type, order: mod.order, underDevelopment: mod.underDevelopment } });
    } catch (err) { next(err); }
};

module.exports = { getModules, updateModule };
