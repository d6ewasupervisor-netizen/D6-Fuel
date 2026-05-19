require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');

const app = express();
const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SIGNOFF_API_KEY;
if (!resendApiKey) {
  console.warn('Warning: RESEND_API_KEY is not set — email sending will fail.');
}
const resend = new Resend(resendApiKey);

/** 3-digit store folder id for subjects, filenames, and headers (e.g. 49 → 049). */
function padStoreId(storeId) {
  const digits = String(storeId || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(3, '0');
}

/** Single-letter suffix A–Z per flow-automation filename contract. */
function auditPhotoLetter(index) {
  if (index < 0 || index > 25) {
    throw new Error(`Too many photos for one fixture (max 26 per fixture, index ${index})`);
  }
  return String.fromCharCode(65 + index);
}

const AUDIT_ALLOWED_STORES = new Set(['049', '053', '214', '286', '351', '486', '652', '657']);
const DEFAULT_AUDIT_INBOX = 'd6ewa.supervisor@gmail.com';
const AUDIT_REVIEWER_APRIL = 'april.gauthier@retailodyssey.com';
const AUDIT_REVIEWER_TYSON = 'tyson.gauthier@retailodyssey.com';

/** FM 053 audits go to Tyson as primary reviewer; all other audit stores go to April. */
function auditEmailRecipients(store, submitterEmail) {
  const inbox = process.env.AUDIT_INBOX_EMAIL || DEFAULT_AUDIT_INBOX;
  const april = process.env.AUDIT_RECIPIENT_EMAIL || AUDIT_REVIEWER_APRIL;
  const toList = store === '053' ? [AUDIT_REVIEWER_TYSON] : [april];
  const ccList = [];

  if (store !== '053' && !ccList.includes(AUDIT_REVIEWER_TYSON)) {
    ccList.push(AUDIT_REVIEWER_TYSON);
  }

  if (submitterEmail) {
    const e = submitterEmail.trim().toLowerCase();
    if (e && !toList.map(x => x.toLowerCase()).includes(e) && !ccList.map(x => x.toLowerCase()).includes(e)) {
      ccList.push(submitterEmail.trim());
    }
  }

  if (!toList.includes(inbox) && !ccList.includes(inbox)) {
    ccList.push(inbox);
  }

  return { toList, ccList, primaryReviewer: store === '053' ? AUDIT_REVIEWER_TYSON : april };
}

app.use(express.json({ limit: '50mb' }));

app.get('/', (req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

const versionFilePath = path.join(__dirname, 'version.json');

app.get('/api/version', (req, res) => {
  try {
    const raw = fs.readFileSync(versionFilePath, 'utf8');
    const data = JSON.parse(raw);
    res.json(data);
  } catch (err) {
    res.json({ version: '1.0.0' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit follow-up submission
//
// Audited stores need extra visual confirmation after the initial reset.
// Resend delivers mail to April (To) and CCs the flow-automation Gmail account
// (d6ewa.supervisor@gmail.com). The local fuel-audit-inbox poller (when wired)
// matches subject ^FM\s*(\d{3})\s+Audit\b and saves attachments to:
//   …\Auston Nix's files - Follow Up Fuel\<049|053|…>\
//
// Canonical attachment names: FM{###}_{Fixture}_{A|B|C}.jpg
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/audit/send', async (req, res) => {
  const { storeId, city, state, address, fixturePhotos, comment, userName, userEmail } = req.body;

  if (!fixturePhotos || !fixturePhotos.length) {
    return res.status(400).json({ error: 'No photos provided.' });
  }

  const store = padStoreId(storeId);
  if (!store) {
    return res.status(400).json({ error: 'Invalid store id.' });
  }
  if (!AUDIT_ALLOWED_STORES.has(store)) {
    return res.status(400).json({ error: `Store FM ${store} is not on the audit list.` });
  }

  const attachments = [];
  const photoListItems = [];
  try {
    fixturePhotos.forEach(fx => {
      fx.photos.forEach((b64, idx) => {
        const letter = auditPhotoLetter(idx);
        const filename = `FM${store}_${fx.fileName}_${letter}.jpg`;
        attachments.push({ filename, content: Buffer.from(b64, 'base64') });
        photoListItems.push(`<li style="margin:4px 0"><code>${filename}</code> — ${fx.label} (#${idx + 1})</li>`);
      });
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const totalPhotos = attachments.length;
  const fromAddress = `FM${store} Audit <FM${store}@the-dump-bin.com>`;

  const { toList, ccList, primaryReviewer } = auditEmailRecipients(store, userEmail);

  // Canonical subject for flow-automation: ^FM\s*(\d{3})\s+Audit\b
  const subject = `FM ${store} Audit — Follow-Up Photos (${city}, ${state})`;

  const submittedBy = userName
    ? `<p style="margin:0 0 16px"><strong>${totalPhotos} audit photo${totalPhotos === 1 ? '' : 's'}</strong> from <strong>${userName}</strong> at FM ${store} — ${city}, ${state}</p>`
    : `<p style="margin:0 0 16px"><strong>${totalPhotos} audit photo${totalPhotos === 1 ? '' : 's'}</strong> from FM ${store} — ${city}, ${state}</p>`;

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: toList,
      cc: ccList,
      subject,
      headers: {
        // Optional hints for flow-automation Gmail parser (subject is primary).
        'X-Fuel-Audit-Store': store,
        'X-Fuel-Audit-Photo-Count': String(totalPhotos),
      },
      html: `
        <div style="font-family:sans-serif;max-width:600px">
          <h2 style="margin:0 0 8px">FM ${store} — Cooler Audit</h2>
          ${submittedBy}
          <p style="color:#666;margin:0 0 4px">${city}, ${state}${address ? ' — ' + address : ''}</p>
          <p style="color:#444;margin:8px 0 16px;background:#fff8dd;border-left:4px solid #ffcc00;padding:10px 12px;border-radius:6px;font-size:13px">
            This is a <strong>follow-up audit</strong>. FM ${store} was flagged by corporate as
            requiring additional documentation. The attached photos visually confirm the four cooler
            fixtures (GDM 9 CSD, GDM 9 All Beverage, HABCO Monster 12 FT, HABCO Red Bull 12 FT).
          </p>
          ${comment ? `
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Field notes:</strong></p>
          <p style="margin:0 0 16px;white-space:pre-wrap;color:#333;background:#f8f8f8;padding:12px;border-radius:6px;border-left:4px solid #4da6ff">${String(comment).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
          ` : ''}
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Attached (${totalPhotos}):</strong></p>
          <ul style="padding-left:20px;margin:0 0 16px;font-family:'JetBrains Mono',monospace;font-size:12px">${photoListItems.join('')}</ul>
          <p style="color:#888;font-size:12px;margin:0">Files are named <code>FM${store}_&lt;Fixture&gt;_A.jpg</code>, <code>_B.jpg</code>, etc. for flow-automation to save under Follow Up Fuel\\${store}\\ on OneDrive.</p>
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="color:#999;font-size:12px;margin:0">Sent from Fuel Cooler Audit Tool · FM ${store}</p>
        </div>
      `,
      attachments
    });

    if (error) {
      console.error('Audit resend error:', error);
      return res.status(400).json({ error: error.message || 'Audit email send failed.' });
    }

    console.log(`Audit email sent for FM ${store} by ${userName || 'unknown'} (${userEmail || 'no email'}) — ${totalPhotos} photo(s) — ID: ${data.id}`);
    res.json({
      success: true,
      id: data.id,
      storeId: store,
      photoCount: totalPhotos,
      primaryReviewer,
      recipients: { to: toList, cc: ccList }
    });
  } catch (err) {
    console.error('Audit server error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/send-photos', async (req, res) => {
  const { storeId, city, state, address, energySet, resetDate, phase, coolerPhotos, comment, userName, userEmail } = req.body;

  if (!coolerPhotos || !coolerPhotos.length) {
    return res.status(400).json({ error: 'No photos provided.' });
  }

  const store = padStoreId(storeId) || String(storeId);
  const phaseLabel = phase === 'after' ? 'After' : 'Before';

  const attachments = coolerPhotos.map(p => ({
    filename: p.fileName,
    content: Buffer.from(p.base64, 'base64')
  }));

  const photoList = coolerPhotos.map(p => `<li style="margin:4px 0">${p.fileName} — ${p.name}</li>`).join('');
  const fromAddress = `FM${store} <FM${store}@the-dump-bin.com>`;

  const ccList = ['tyson.gauthier@retailodyssey.com'];
  if (userEmail) ccList.push(userEmail);

  const submittedBy = userName
    ? `<p style="margin:0 0 16px"><strong>${coolerPhotos.length} ${phaseLabel.toLowerCase()} photos</strong> from <strong>${userName}</strong> at FM ${store} — ${city}, ${state}</p>`
    : `<p style="margin:0 0 16px"><strong>${coolerPhotos.length} ${phaseLabel.toLowerCase()} photos</strong> from FM ${store} — ${city}, ${state}</p>`;

  try {
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: 'april.gauthier@retailodyssey.com',
      cc: ccList,
      subject: `FM ${store} ${phaseLabel} Photos — ${city}, ${state}`,
      html: `
        <div style="font-family:sans-serif;max-width:600px">
          <h2 style="margin:0 0 8px">FM ${store} — ${phaseLabel} Photos</h2>
          ${submittedBy}
          <p style="color:#666;margin:0 0 4px">${city}, ${state} — ${address}</p>
          <p style="color:#666;margin:0 0 16px">${energySet} energy set · Reset: ${resetDate}</p>
          ${comment ? `
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Comments:</strong></p>
          <p style="margin:0 0 16px;white-space:pre-wrap;color:#333;background:#f8f8f8;padding:12px;border-radius:6px;border-left:4px solid #4da6ff">${comment.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
          ` : ''}
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Photos attached:</strong></p>
          <ul style="padding-left:20px;margin:0 0 16px">${photoList}</ul>
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="color:#999;font-size:12px;margin:0">Sent from Fuel Cooler Reset Guide</p>
        </div>
      `,
      attachments
    });

    if (error) {
      console.error('Resend error:', error);
      return res.status(400).json({ error: error.message || 'Email send failed.' });
    }

    console.log(`Email sent for FM ${store} by ${userName || 'unknown'} (${userEmail || 'no email'})${comment ? ' [with comments]' : ''} — ID: ${data.id}`);
    res.json({ success: true, id: data.id });
  } catch (err) {
    console.error('Server error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Fuel server running on port ${PORT}`);
});
