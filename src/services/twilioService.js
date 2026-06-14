/**
 * Twilio SMS Service (International)
 * Docs: https://www.twilio.com/docs/sms/send-messages
 *
 * Required env vars:
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_PHONE_NUMBER — your Twilio phone number in E.164 format (+14155550100)
 */

const sendOtpViaTwilio = async (mobileNumber, otp) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
        throw new Error('Twilio credentials not configured');
    }

    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const body = `Your verification code is: ${otp}. Valid for 5 minutes. Do not share with anyone.`;

    const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        {
            method: 'POST',
            headers: {
                Authorization: `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                To: mobileNumber,
                From: fromNumber,
                Body: body,
            }).toString(),
        }
    );

    const data = await response.json();
    if (!response.ok) {
        throw new Error(`Twilio error: ${data.message || 'send failed'}`);
    }
    return data;
};

module.exports = { sendOtpViaTwilio };
