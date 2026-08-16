const nodemailer = require('nodemailer');

/**
 * Send an email.
 *
 * Delivery method (in order):
 *  1. Brevo HTTP API (when BREVO_API_KEY is set) — uses HTTPS/443, which hosting
 *     platforms like Railway never block. This is the reliable path in production.
 *  2. SMTP via nodemailer (fallback) — needs outbound port 587/2525 open, which
 *     some hosts block; that's why the HTTP API is preferred.
 *
 * Returns an info-like object: { messageId, accepted, response }.
 */
const FROM_EMAIL = () => process.env.SMTP_FROM || process.env.SMTP_USER;
const FROM_NAME = () => process.env.EMAIL_FROM_NAME || 'DealerSetu';

// ── 1. Brevo HTTP API ────────────────────────────────────────────
async function sendViaBrevoApi({ to, subject, html }) {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'api-key': process.env.BREVO_API_KEY,
            'content-type': 'application/json',
            accept: 'application/json',
        },
        body: JSON.stringify({
            sender: { email: FROM_EMAIL(), name: FROM_NAME() },
            to: [{ email: to }],
            subject,
            htmlContent: html,
        }),
    });

    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { /* keep raw text */ }

    if (!res.ok) {
        // Surface Brevo's exact reason (e.g. sender not verified, invalid key)
        const reason = (body && (body.message || body.code)) || text || `HTTP ${res.status}`;
        throw new Error(`Brevo API ${res.status}: ${reason}`);
    }

    return {
        messageId: body?.messageId || 'brevo-api-ok',
        accepted: [to],
        response: `Brevo API ${res.status}`,
    };
}

// ── 2. SMTP fallback ─────────────────────────────────────────────
async function sendViaSmtp({ to, subject, html }) {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        },
        // Fail fast instead of hanging when the host blocks outbound SMTP.
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
    });

    return transporter.sendMail({
        from: FROM_EMAIL(),
        to,
        subject,
        html,
    });
}

const sendEmail = async ({ to, subject, html }) => {
    if (process.env.BREVO_API_KEY) {
        try {
            return await sendViaBrevoApi({ to, subject, html });
        } catch (apiErr) {
            console.error('Brevo HTTP API send failed, falling back to SMTP:', apiErr.message);
            // Fall through to SMTP so a transient API issue still delivers.
        }
    }
    return sendViaSmtp({ to, subject, html });
};

module.exports = { sendEmail };
