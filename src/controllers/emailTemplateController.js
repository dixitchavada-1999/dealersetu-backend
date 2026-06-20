const EmailTemplate = require('../models/emailTemplateModel');
const EmailVariable = require('../models/emailVariableModel');
const { renderEmailTemplate } = require('../utils/renderEmailTemplate');
const { DEFAULT_EMAIL_TEMPLATES } = require('../utils/defaultEmailTemplates');
const { getGlobalVarsMap } = require('../utils/emailVariables');

// Fields a super-admin may edit (key/name are immutable identity fields).
const EDITABLE = ['name', 'description', 'subject', 'heading', 'bodyTop', 'highlightKey', 'bodyBottom', 'footerText', 'brandColor', 'logoUrl', 'placeholders', 'isActive'];

// Sample data for live preview, so {{otp}} etc. show realistic values.
const PREVIEW_SAMPLE = { otp: '475634', name: 'Dixit', loginCode: 'HH7JD6TY' };

// GET /api/super-admin/email-templates
const getEmailTemplates = async (req, res) => {
  try {
    const templates = await EmailTemplate.find().sort({ name: 1 }).lean();
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch email templates' });
  }
};

// GET /api/super-admin/email-templates/:key
const getEmailTemplate = async (req, res) => {
  try {
    const template = await EmailTemplate.findOne({ key: req.params.key }).lean();
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch email template' });
  }
};

// PUT /api/super-admin/email-templates/:key  — update editable content fields
const updateEmailTemplate = async (req, res) => {
  try {
    const updates = {};
    for (const field of EDITABLE) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }
    if (!updates.subject && req.body.subject === '') {
      return res.status(400).json({ success: false, message: 'Subject is required' });
    }
    const template = await EmailTemplate.findOneAndUpdate(
      { key: req.params.key },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, message: 'Template updated', data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to update template' });
  }
};

// POST /api/super-admin/email-templates  — create a new template
const createEmailTemplate = async (req, res) => {
  try {
    const { key, name, subject } = req.body;
    if (!key || !name || !subject) {
      return res.status(400).json({ success: false, message: 'key, name and subject are required' });
    }
    const normalizedKey = String(key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
    const exists = await EmailTemplate.findOne({ key: normalizedKey });
    if (exists) return res.status(400).json({ success: false, message: 'A template with this key already exists' });

    const doc = { key: normalizedKey };
    for (const field of EDITABLE) {
      if (req.body[field] !== undefined) doc[field] = req.body[field];
    }
    const template = await EmailTemplate.create(doc);
    res.status(201).json({ success: true, message: 'Template created', data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to create template' });
  }
};

// DELETE /api/super-admin/email-templates/:key
const deleteEmailTemplate = async (req, res) => {
  try {
    const deleted = await EmailTemplate.findOneAndDelete({ key: req.params.key });
    if (!deleted) return res.status(404).json({ success: false, message: 'Template not found' });
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete template' });
  }
};

// POST /api/super-admin/email-templates/preview  — render HTML from posted fields
// (used by the live preview pane; does not persist anything)
const previewEmailTemplate = async (req, res) => {
  try {
    const globals = await getGlobalVarsMap();
    const sample = { ...globals, ...PREVIEW_SAMPLE, ...(req.body.sampleData || {}) };
    const { subject, html } = renderEmailTemplate(req.body, sample);
    res.json({ success: true, data: { subject, html } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to render preview' });
  }
};

// ── Global custom variables ───────────────────────────────────

// GET /api/super-admin/email-templates/variables
const getVariables = async (req, res) => {
  try {
    const vars = await EmailVariable.find().sort({ key: 1 }).lean();
    res.json({ success: true, data: vars });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch variables' });
  }
};

// POST /api/super-admin/email-templates/variables  — create or update by key
const upsertVariable = async (req, res) => {
  try {
    const { key, value, description } = req.body;
    if (!key || !String(key).trim()) return res.status(400).json({ success: false, message: 'Variable key is required' });
    const normalizedKey = String(key).trim().replace(/[^a-zA-Z0-9_]/g, '');
    if (!normalizedKey) return res.status(400).json({ success: false, message: 'Invalid variable key' });
    const variable = await EmailVariable.findOneAndUpdate(
      { key: normalizedKey },
      { $set: { value: value || '', description: description || '' } },
      { new: true, upsert: true }
    ).lean();
    res.json({ success: true, message: 'Variable saved', data: variable });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message || 'Failed to save variable' });
  }
};

// DELETE /api/super-admin/email-templates/variables/:key
const deleteVariable = async (req, res) => {
  try {
    await EmailVariable.findOneAndDelete({ key: req.params.key });
    res.json({ success: true, message: 'Variable deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to delete variable' });
  }
};

// POST /api/super-admin/email-templates/reset/:key — restore code default
const resetEmailTemplate = async (req, res) => {
  try {
    const def = DEFAULT_EMAIL_TEMPLATES[req.params.key];
    if (!def) return res.status(404).json({ success: false, message: 'No default for this key' });
    const template = await EmailTemplate.findOneAndUpdate(
      { key: req.params.key },
      { $set: def },
      { new: true, upsert: true }
    ).lean();
    res.json({ success: true, message: 'Template reset to default', data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reset template' });
  }
};

module.exports = {
  getEmailTemplates,
  getEmailTemplate,
  createEmailTemplate,
  updateEmailTemplate,
  deleteEmailTemplate,
  previewEmailTemplate,
  resetEmailTemplate,
  getVariables,
  upsertVariable,
  deleteVariable,
};
