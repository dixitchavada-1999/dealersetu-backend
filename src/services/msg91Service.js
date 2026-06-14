/**
 * MSG91 SMS Service (India)
 * Docs: https://docs.msg91.com/
 *
 * Required env vars:
 *   MSG91_AUTH_KEY    — your authkey from dashboard
 *   MSG91_SENDER_ID   — 6-char approved sender id (e.g., "SHPADM")
 *   MSG91_TEMPLATE_ID — DLT-approved template id for OTP
 */

const sendOtpViaMsg91 = async (mobileNumber, otp) => {
    const authKey = process.env.MSG91_AUTH_KEY;
    const templateId = process.env.MSG91_TEMPLATE_ID;

    if (!authKey || !templateId) {
        throw new Error('MSG91 credentials not configured');
    }

    // Strip leading + and country-code zero padding (MSG91 expects E.164 without +)
    const number = mobileNumber.replace(/^\+/, '');

    const response = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            authkey: authKey,
        },
        body: JSON.stringify({
            template_id: templateId,
            mobile: number,
            otp: otp,
        }),
    });

    const data = await response.json();
    if (!response.ok || data.type === 'error') {
        throw new Error(`MSG91 error: ${data.message || 'send failed'}`);
    }
    return data;
};

module.exports = { sendOtpViaMsg91 };
