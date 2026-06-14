/**
 * SMS Service Router
 *
 * Routes OTP sending to the correct provider:
 *   - Indian numbers (+91) → MSG91
 *   - All other numbers   → Twilio
 *
 * In development mode (no credentials), OTP is logged to console instead of
 * sending a real SMS. This allows full end-to-end testing without SMS cost.
 */

const { sendOtpViaMsg91 } = require('./msg91Service');
const { sendOtpViaTwilio } = require('./twilioService');

/**
 * Normalize mobile number to E.164 (+<country><number>).
 * - "9876543210"    → "+919876543210" (default to India if 10-digit)
 * - "+919876543210" → "+919876543210"
 * - "919876543210"  → "+919876543210"
 */
const normalizeMobile = (mobile, defaultCountryCode = '+91') => {
    if (!mobile) return '';
    const cleaned = mobile.replace(/[\s-()]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.length === 10) return `${defaultCountryCode}${cleaned}`;
    return `+${cleaned}`;
};

/**
 * Decide which provider to use for a given E.164 number.
 */
const pickProvider = (e164Mobile) => {
    if (e164Mobile.startsWith('+91')) return 'msg91';
    return 'twilio';
};

/**
 * Check if SMS credentials are configured for a provider.
 */
const isProviderConfigured = (provider) => {
    if (provider === 'msg91') {
        return !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);
    }
    if (provider === 'twilio') {
        return !!(
            process.env.TWILIO_ACCOUNT_SID &&
            process.env.TWILIO_AUTH_TOKEN &&
            process.env.TWILIO_PHONE_NUMBER
        );
    }
    return false;
};

/**
 * Send OTP via the appropriate provider.
 * Returns { sent: boolean, provider: string, devMode: boolean }
 */
const sendOtpSms = async (mobileNumber, otp) => {
    const e164 = normalizeMobile(mobileNumber);
    const provider = pickProvider(e164);

    // Dev mode: no credentials configured
    if (!isProviderConfigured(provider)) {
        console.log('');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📱 [DEV MODE] OTP for ${e164}`);
        console.log(`🔐 OTP: ${otp}`);
        console.log(`📡 Would send via: ${provider.toUpperCase()}`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('');
        return { sent: true, provider, devMode: true };
    }

    // Real SMS send
    try {
        if (provider === 'msg91') {
            await sendOtpViaMsg91(e164, otp);
        } else {
            await sendOtpViaTwilio(e164, otp);
        }
        return { sent: true, provider, devMode: false };
    } catch (err) {
        console.error(`SMS send failed (${provider}):`, err.message);
        throw err;
    }
};

module.exports = { sendOtpSms, normalizeMobile, pickProvider, isProviderConfigured };
