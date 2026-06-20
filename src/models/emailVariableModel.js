const mongoose = require('mongoose');

/**
 * EmailVariable — global, admin-defined static variables usable in ANY email
 * template (e.g. {{companyName}}, {{supportEmail}}).
 *
 * Merged into every render/send as defaults; per-send data (otp, name, ...)
 * overrides a global with the same key.
 */
const emailVariableSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    value: { type: String, default: '' },
    description: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailVariable', emailVariableSchema);
