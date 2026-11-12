import QRCode from 'qrcode';
import type { describe } from './cookies.js';

type Cookie = ReturnType<typeof describe>;
const escape = (text: unknown) => String(text).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]!);

function shell(title: string, body: string) {
  return `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#a88b72">
    <title>${escape(title)}</title><link rel="stylesheet" href="/certificate.css">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <script src="/certificate.js" defer></script>
    </head><body>${body}</body></html>`;
}

export function notFoundPage() {
  return shell('Cookie not found', `<main class="paper"><div class="symbol">🍪</div>
    <p class="eyebrow">Official cookie registry</p><h1>Cookie not found.</h1>
    <p>This ID was not issued by this service.</p><a href="/">Get a new cookie</a></main>`);
}

export async function certificatePage(cookie: Cookie, printView: boolean) {
  const qr = await QRCode.toDataURL(cookie.verificationUrl, {
    width: 360, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#241b14', light: '#ffffff' }
  });
  const printedAt = new Date().toISOString();
  return shell(printView ? 'Cookie certificate' : 'Verify your cookie', `
    <main class="paper">
      <div class="symbol">🍪</div>
      <p class="eyebrow">A cookie for you · official registry</p>
      <h1>${printView ? 'Cookie Certificate' : 'Verified cookie'}</h1>
      <p class="subtitle">This cookie was issued by our server.</p>
      <p class="rarity">${escape(cookie.rarity)}</p>
      <p class="probability">${escape(cookie.rarityProbabilityPercent)}% of random cookies · rules v${cookie.rulesVersion}</p>
      <dl>
        <div><dt>Original cookie ID</dt><dd class="hash">${cookie.id}</dd></div>
        <div><dt>Issued at (UTC)</dt><dd>${escape(cookie.createdAt)}</dd></div>
        <div><dt>Longest matching sequence</dt><dd>${cookie.maxStreak} characters</dd></div>
        <div><dt>Current state</dt><dd>${cookie.status === 'eaten' ? 'Eaten — no bites remaining' : `${cookie.bitesRemaining} of 3 bites remaining`}</dd></div>
        ${cookie.eatenAt ? `<div><dt>Eaten at (UTC)</dt><dd>${escape(cookie.eatenAt)}</dd></div>` : ''}
        <div><dt>Checked at (UTC)</dt><dd>${printedAt}</dd></div>
      </dl>
      <div class="verification"><img src="${qr}" alt="QR code linking to the official verification page" width="140" height="140">
        <div><strong>Check the official record</strong><p>Scan to compare the ID, rarity and current state.</p>
        <a class="verification-url" href="${escape(cookie.verificationUrl)}">${escape(cookie.verificationUrl)}</a></div></div>
      <p class="note">This is an issuance record, not proof of exclusive ownership. A PDF can be edited or copied.
        Verify it on the official domain shown above. The state shown here is a snapshot; the online record may change.</p>
      <nav class="actions" aria-label="Certificate actions">
        <button id="print" type="button">Print / Save as PDF</button>
        <a href="${escape(cookie.shareUrl)}">View cookie</a>
        <a href="/">Get a new cookie</a>
      </nav>
    </main>`);
}
