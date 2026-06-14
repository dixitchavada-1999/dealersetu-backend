/**
 * Seed the Module collection from config/modules.js (idempotent), and migrate
 * any existing under-development flags from PlatformSettings.
 *
 * Usage: node src/scripts/seedModules.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);
    const Module = require('../models/moduleModel');
    const PlatformSettings = require('../models/platformSettingsModel');
    const { MODULES } = require('../config/modules');

    // Carry over previously-set under-development modules (if any).
    const ps = await PlatformSettings.findOne({ key: 'platform' }).lean();
    const underDev = new Set(ps?.underDevelopmentModules || []);

    let created = 0, updated = 0;
    for (const def of MODULES) {
        const existing = await Module.findOne({ key: def.key });
        if (!existing) {
            await Module.create({
                key: def.key,
                label: def.label,
                type: def.type,
                order: def.order,
                underDevelopment: underDev.has(def.key),
                isActive: true,
            });
            created++;
        } else {
            // Keep admin's type/under-dev edits; only backfill label/order if missing.
            existing.label = existing.label || def.label;
            if (existing.order == null) existing.order = def.order;
            await existing.save();
            updated++;
        }
    }
    console.log(`Modules seeded: ${created} created, ${updated} existing.`);
    await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
