const EmailTemplate = require('../models/emailTemplateModel');
const { sendEmail } = require('./sendEmail');
const { renderEmailTemplate } = require('./renderEmailTemplate');
const { DEFAULT_EMAIL_TEMPLATES } = require('./defaultEmailTemplates');
const { getGlobalVarsMap } = require('./emailVariables');

/**
 * Send an email by template key.
 *
 *   await sendTemplatedEmail('password_reset', user.email, { otp, name });
 *
 * Looks up the active stored template for `key`; if none exists, falls back
 * to the built-in default for that key. Placeholders in the template are
 * filled from `data`. Throws if neither a stored nor default template exists.
 */
async function sendTemplatedEmail(key, to, data = {}) {
  let template = null;
  try {
    template = await EmailTemplate.findOne({ key, isActive: true }).lean();
  } catch (err) {
    console.error(`sendTemplatedEmail: DB lookup failed for "${key}":`, err.message);
  }

  if (!template) {
    template = DEFAULT_EMAIL_TEMPLATES[key];
  }
  if (!template) {
    throw new Error(`No email template found for key "${key}"`);
  }

  // Global custom variables are defaults; per-send data overrides them.
  const globals = await getGlobalVarsMap();
  const merged = { ...globals, ...data };

  // Platform Settings logo (super-admin) overrides the per-template logo when set.
  let platformLogo = '';
  try {
    const PlatformSettings = require('../models/platformSettingsModel');
    const settings = await PlatformSettings.getSettings();
    platformLogo = settings?.logoUrl || '';
  } catch (err) {
    console.error('sendTemplatedEmail: platform settings lookup failed:', err.message);
  }
  const tpl = platformLogo ? { ...template, logoUrl: platformLogo } : template;

  const { subject, html } = renderEmailTemplate(tpl, merged);
  await sendEmail({ to, subject, html });
}

module.exports = { sendTemplatedEmail };
