/**
 * Built-in default email templates.
 *
 * Used as a fallback by sendTemplatedEmail when no active DB template exists
 * for a key, and as the seed source (node src/scripts/seedEmailTemplates.js).
 *
 * To add a new email: add an entry here keyed by its slug, declare its
 * `placeholders`, then call sendTemplatedEmail('<key>', to, { ...those vars }).
 */
const LOGO_URL =
  'https://res.cloudinary.com/dpy58lnw6/image/upload/e_background_removal/e_trim/c_pad,w_480,h_140/v1781807258/dealersetu/branding/logo-email.png';

const DEFAULT_EMAIL_TEMPLATES = {
  password_reset: {
    key: 'password_reset',
    name: 'Password Reset OTP',
    description: 'Sent when a user requests a password reset. Delivers the 6-digit OTP.',
    subject: 'Your DealerSetu password reset code',
    heading: 'Password Reset Request',
    bodyTop:
      'Hi {{name}},\nWe received a request to reset your password. Use the verification code below to continue:',
    highlightKey: 'otp',
    bodyBottom:
      'This code will expire in 15 minutes.\nIf you didn\'t request a password reset, you can safely ignore this email — your password won\'t be changed.',
    footerText: '© 2026 DealerSetu. All rights reserved.',
    brandColor: '#0F52BA',
    logoUrl: LOGO_URL,
    placeholders: ['otp', 'name'],
    isActive: true,
  },

  customer_welcome: {
    key: 'customer_welcome',
    name: 'Customer Welcome',
    description: 'Sent when an owner creates a customer. Delivers their login/activation code.',
    subject: 'Welcome to {{shopName}} — your login code inside',
    heading: 'Welcome to {{shopName}}!',
    bodyTop:
      'Hi {{name}},\nYour account has been created on {{shopName}}. Use the login code below to activate your account and set your password:',
    highlightKey: 'loginCode',
    bodyBottom: 'Open the DealerSetu app, choose "Customer Login", and enter this code to get started.',
    footerText: '© 2026 DealerSetu. All rights reserved.',
    brandColor: '#0F52BA',
    logoUrl: LOGO_URL,
    placeholders: ['name', 'loginCode', 'shopName'],
    isActive: true,
  },

  activation_code: {
    key: 'activation_code',
    name: 'Account Activation Code',
    description: 'Sent to a new customer with their login/activation code.',
    subject: 'Your DealerSetu account is ready',
    heading: 'Welcome to DealerSetu',
    bodyTop:
      'Hi {{name}},\nYour account has been created. Use the login code below to activate your account and set your password:',
    highlightKey: 'loginCode',
    bodyBottom: 'Open the DealerSetu app and enter this code to get started.',
    footerText: '© 2026 DealerSetu. All rights reserved.',
    brandColor: '#0F52BA',
    logoUrl: LOGO_URL,
    placeholders: ['loginCode', 'name'],
    isActive: true,
  },
};

module.exports = { DEFAULT_EMAIL_TEMPLATES, LOGO_URL };
