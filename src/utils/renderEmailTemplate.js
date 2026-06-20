/**
 * Render a structured EmailTemplate into the fixed branded HTML layout.
 *
 *   renderEmailTemplate(template, data) -> { subject, html }
 *
 * - {{placeholder}} tokens in subject/heading/bodyTop/bodyBottom/footerText
 *   are replaced from `data`.
 * - If template.highlightKey is set and data[highlightKey] exists, a big
 *   code/highlight card is rendered between the top and bottom body.
 *
 * Used by sendTemplatedEmail and the super-admin live-preview endpoint, so
 * the preview matches the real email exactly.
 */

const escapeHtml = (s = '') =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Replace {{key}} tokens. Missing keys -> '' (kept simple/safe).
const interpolate = (text = '', data = {}) =>
  String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => {
    const v = data[k];
    return v === undefined || v === null ? '' : String(v);
  });

// Turn a multi-line string into <p> paragraphs (blank lines split paragraphs,
// single newlines become <br>). Already-interpolated text is escaped.
const paragraphs = (text, color) => {
  if (!text || !String(text).trim()) return '';
  return String(text)
    .split(/\n\s*\n/)
    .map((para) => {
      const html = escapeHtml(para.trim()).replace(/\n/g, '<br />');
      return `<p style="margin:0 0 14px 0;color:${color};font-size:15px;line-height:22px;">${html}</p>`;
    })
    .join('');
};

function renderEmailTemplate(template, data = {}) {
  const t = template || {};
  const brand = t.brandColor || '#0F52BA';
  const logoUrl = t.logoUrl || '';

  const subject = interpolate(t.subject || '', data);
  const heading = interpolate(t.heading || '', data);
  const bodyTop = interpolate(t.bodyTop || '', data);
  const bodyBottom = interpolate(t.bodyBottom || '', data);
  const footerText = interpolate(t.footerText || '', data);

  // Optional highlight (e.g. OTP) card
  let highlightHtml = '';
  if (t.highlightKey && data[t.highlightKey] !== undefined && data[t.highlightKey] !== null && String(data[t.highlightKey]) !== '') {
    const value = escapeHtml(String(data[t.highlightKey]));
    highlightHtml = `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px 0;">
        <tr><td align="center" style="background-color:#eff4ff;border:1px solid #dbe6ff;border-radius:12px;padding:20px;">
          <span style="font-size:34px;font-weight:bold;letter-spacing:10px;color:${brand};font-family:'Courier New',monospace;">${value}</span>
        </td></tr>
      </table>`;
  }

  const logoHtml = logoUrl
    ? `<img src="${logoUrl}" alt="DealerSetu" width="240" style="display:block;margin:0 auto;width:240px;max-width:75%;height:auto;border:0;outline:none;text-decoration:none;" />`
    : `<span style="color:#ffffff;font-size:24px;font-weight:bold;letter-spacing:0.5px;">DealerSetu</span>`;

  const html = `
  <div style="margin:0;padding:0;background-color:#f1f5f9;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
          <tr><td style="background-color:${brand};background-image:linear-gradient(135deg,${brand} 0%,#0A3D8F 100%);padding:28px 24px;text-align:center;">
            ${logoHtml}
          </td></tr>
          <tr><td style="padding:32px 32px 24px 32px;">
            ${heading ? `<h1 style="margin:0 0 14px 0;color:#0f172a;font-size:20px;font-weight:bold;">${escapeHtml(heading)}</h1>` : ''}
            ${paragraphs(bodyTop, '#475569')}
            ${highlightHtml}
            ${paragraphs(bodyBottom, '#64748b')}
          </td></tr>
          <tr><td style="border-top:1px solid #e2e8f0;padding:20px 32px;text-align:center;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">${escapeHtml(footerText)}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </div>`;

  return { subject, html };
}

module.exports = { renderEmailTemplate, interpolate };
