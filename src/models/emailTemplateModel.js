const mongoose = require('mongoose');

/**
 * EmailTemplate — platform-level (super-admin managed) email templates.
 *
 * Emails are sent dynamically by `key` (slug): any feature calls
 * sendTemplatedEmail(key, to, data) and the stored template is rendered
 * into the fixed branded layout. Falls back to a default if the key is
 * missing or inactive.
 *
 * The layout is fixed (header + heading + body + optional highlight code
 * card + footer); super-admin edits the content fields only ("structured").
 */
const emailTemplateSchema = new mongoose.Schema(
  {
    // Unique slug used in code, e.g. 'password_reset', 'activation_code'
    key: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    // Human-friendly name shown in the super-admin UI
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    // ── Editable content (supports {{placeholder}} tokens) ──
    subject: { type: String, required: true },
    heading: { type: String, default: '' },
    // Paragraphs above the highlight card (use \n to separate paragraphs)
    bodyTop: { type: String, default: '' },
    // Name of the data field rendered in the big highlight card (e.g. 'otp').
    // Empty -> no highlight card is rendered.
    highlightKey: { type: String, default: '' },
    // Paragraphs below the highlight card (e.g. expiry / ignore note)
    bodyBottom: { type: String, default: '' },
    footerText: { type: String, default: '© DealerSetu. All rights reserved.' },

    // ── Branding ──
    brandColor: { type: String, default: '#0F52BA' },
    logoUrl: {
      type: String,
      default:
        'https://res.cloudinary.com/dpy58lnw6/image/upload/e_background_removal/e_trim/c_pad,w_480,h_140/v1781807258/dealersetu/branding/logo-email.png',
    },

    // Available placeholders for this template (UI hint only), e.g. ['otp','name']
    placeholders: { type: [String], default: [] },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('EmailTemplate', emailTemplateSchema);
