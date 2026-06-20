/*
 * Seed / sync email templates from the built-in defaults.
 * Creates any missing templates; leaves existing (admin-edited) ones untouched.
 * Run: node src/scripts/seedEmailTemplates.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const EmailTemplate = require('../models/emailTemplateModel');
const { DEFAULT_EMAIL_TEMPLATES } = require('../utils/defaultEmailTemplates');

(async () => {
  if (!process.env.MONGO_URI) {
    console.error('❌ MONGO_URI not set.');
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✅ Connected:', mongoose.connection.name, '\n');

  let created = 0, existing = 0;
  for (const def of Object.values(DEFAULT_EMAIL_TEMPLATES)) {
    const found = await EmailTemplate.findOne({ key: def.key });
    if (found) {
      // Keep admin edits; only refresh the code-defined metadata.
      found.name = def.name;
      found.description = def.description;
      found.placeholders = def.placeholders;
      await found.save();
      existing++;
      console.log(`  • exists (kept content): ${def.key}`);
    } else {
      await EmailTemplate.create(def);
      created++;
      console.log(`  ✅ created: ${def.key}`);
    }
  }

  console.log(`\n📊 ${created} created · ${existing} existing`);
  await mongoose.connection.close();
  process.exit(0);
})().catch(async (e) => { console.error('❌', e.message); try { await mongoose.connection.close(); } catch {} process.exit(1); });
