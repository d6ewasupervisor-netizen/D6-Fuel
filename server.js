require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { Resend } = require('resend');
const tracker = require('./lib/tracker');
const trackerNotify = require('./lib/tracker-notify');
const fruitAuditTracker = require('./lib/fruit-audit-tracker');
const fruitAuditTrackerNotify = require('./lib/fruit-audit-tracker-notify');
const fruitAuditManifest = require('./data/fruit-audit-manifest.json');

function trackerDashboardUrl(req) {
  const base = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/dashboard`;
}

function fruitAuditDashboardUrl(req) {
  const base = process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/$/, '')}/fruit-audit-dashboard`;
}

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
const DEFAULT_FRUIT_AUDIT_RECIPIENT = DEFAULT_AUDIT_INBOX;
const FRUIT_AUDIT_CONFIG_BY_DISTRICT = {
  '1': {
    subjectPrefix: '[P5W3 D1 Fruit Photos]',
    saveRoot: String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D1`,
    from: 'D1 Fruit Audit <fruitaudit@the-dump-bin.com>',
  },
  '8': {
    subjectPrefix: '[P5W3 D8 Fruit Photos]',
    saveRoot: String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D8`,
    from: 'D8 Fruit Audit <fruitaudit@the-dump-bin.com>',
  },
};
const DEFAULT_FRUIT_AUDIT_APPROVED_EMAILS = [
  DEFAULT_AUDIT_INBOX,
  'ruth.northcutt@sasretailservices.com',
  'tyson.gauthier@retailodyssey.com',
  'tyson.a.gauthier@gmail.com',
];
const DEFAULT_D1_FRUIT_AUDIT_SIGNUP_EMAILS = [
  'amydawnhaertel@gmail.com',
  'akafatamy46@gmail.com',
  'kalleen.iniguezcarri@retailodyssey.com',
  'cindi.griggs@retailodyssey.com',
  'jasmine91959@hotmail.com',
  'crystalhannon23@gmail.com',
  'dlbrookens@outlook.com',
  'bryndle.dev@gmail.com',
  'witt53@gmail.com',
  'geroldtinsley31@gmail.com',
  'xrenlinn@gmail.com',
  'hcsch@frontier.com',
  'darkctm0@gmail.com',
  'jahwitcher907@gmail.com',
  'jennifer.russell@sasretailservices.com',
  'niemijeremy001@gmail.com',
  'julie.ferguson@retailodyssey.com',
  'julie.slaughter@youradv.com',
  '40ktaylor@gmail.com',
  'karlagamroth@gmail.com',
  'oneeightykaty@yahoo.com',
  'thefifers@msn.com',
  'kim.sanchezcanastuj@retailodyssey.com',
  'laramie.oedell@retailodyssey.com',
  'laurel.a.sv@gmail.com',
  'pozaryckidianne63@gmail.com',
  'missy7826@yahoo.com',
  'michaelmcconnell007@comcast.net',
  'michelle.sweet@youradv.com',
  'olli.witt@gmx.de',
  'omar.robles@retailodyssey.com',
  'pamela.gardner@sasretailservices.com',
  'patricia.marks@youradv.com',
  'prscoppe315@gmail.com',
  'robyn.bukowatzgrill@sasretailservices.com',
  'royann.lund@gmail.com',
  'rubdog622651@gmail.com',
  'barajassaraeloisa@gmail.com',
  'tamera.sandeno@retailodyssey.com',
  'victor.trevino@retailodyssey.com',
  'virlaineferrari@gmail.com',
  'zmharrington01@gmail.com',
  'zachary.house176@gmail.com',
];
const REQUIRED_FRUIT_AUDIT_SIDES = [
  { id: 'front', label: 'Front' },
  { id: 'right', label: 'Right Side' },
  { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left Side' },
];
const fruitAuditStores = new Map((fruitAuditManifest.stores || []).map(store => [store.id, store]));

function fruitAuditDistrict(store) {
  return String((store && store.district) || fruitAuditManifest.district || '8');
}

function fruitAuditConfig(district) {
  return FRUIT_AUDIT_CONFIG_BY_DISTRICT[String(district || '')] || FRUIT_AUDIT_CONFIG_BY_DISTRICT['8'];
}

function isD1FruitStoreClaimedBySubmitter(storeId, email) {
  const submitterEmail = normalizeEmail(email);
  if (!submitterEmail) return false;
  const snapshot = fruitAuditTracker.getSnapshot();
  const store = (snapshot.stores || []).find(item => item.id === storeId);
  return !!(
    store
    && store.status === 'pledged'
    && store.pledge
    && normalizeEmail(store.pledge.email) === submitterEmail
  );
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function splitEmailList(value) {
  return String(value || '')
    .split(/[,\s]+/)
    .map(email => email.trim())
    .filter(Boolean);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function fruitAuditApprovedEmails() {
  const configured = splitEmailList(process.env.FRUIT_AUDIT_APPROVED_EMAILS);
  const base = configured.length ? configured : DEFAULT_FRUIT_AUDIT_APPROVED_EMAILS;
  return new Set([...base, ...DEFAULT_D1_FRUIT_AUDIT_SIGNUP_EMAILS].map(normalizeEmail));
}

function isFruitAuditApprovedUser(email) {
  return fruitAuditApprovedEmails().has(normalizeEmail(email));
}

function d1FruitAuditSignupEmails() {
  const configured = splitEmailList(process.env.D1_FRUIT_AUDIT_SIGNUP_EMAILS);
  const base = configured.length ? configured : DEFAULT_D1_FRUIT_AUDIT_SIGNUP_EMAILS;
  return new Set([...DEFAULT_FRUIT_AUDIT_APPROVED_EMAILS, ...base].map(normalizeEmail));
}

function isD1FruitAuditSignupUser(email) {
  return d1FruitAuditSignupEmails().has(normalizeEmail(email));
}

function addUniqueEmail(list, email) {
  const trimmed = String(email || '').trim();
  if (!trimmed) return;
  const exists = list.some(existing => existing.toLowerCase() === trimmed.toLowerCase());
  if (!exists) list.push(trimmed);
}

function fruitSetLabel(set) {
  return `${set.commodityGroup} ${set.aisleDesc} bays ${set.bayRange}`;
}

function fileSafe(value, fallback = 'Item', maxLength = 60) {
  const safe = String(value || fallback)
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
  return safe || fallback;
}

function fruitSetFolderName(set) {
  return [
    `C${set.commodity}`,
    fileSafe(set.commodityGroup, 'Fruit', 30),
    `POG${set.pogDbKey}`,
    fileSafe(set.aisleDesc, 'Produce_Table', 35),
    `Bays${fileSafe(set.bayRange, 'Bay', 20)}`,
  ].join(' - ');
}

function fruitAttachmentName(store, set, side, photoIndex) {
  const district = fruitAuditDistrict(store);
  const bays = String(set.bayRange || '')
    .replace(/[^0-9A-Za-z]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const sequence = String(photoIndex + 1).padStart(2, '0');
  const sideLabel = fileSafe(side.label, side.id, 20);
  const group = fileSafe(set.commodityGroup, `C${set.commodity}`, 35);
  return `D${district}_Fruit_FM${store.id}_${group}_POG${set.pogDbKey}_${fileSafe(set.aisleDesc, 'Produce_Table', 35)}_Bays${bays}_${sideLabel}_${sequence}.jpg`;
}

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

app.get('/fruit-audit', (req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.sendFile(path.join(__dirname, 'public', 'fruit-audit.html'));
});

app.get('/fruit-audit-guide', (req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  res.sendFile(path.join(__dirname, 'public', 'fruit-audit-guide.html'));
});

app.get('/fruit-audit-dashboard', (req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.sendFile(path.join(__dirname, 'public', 'fruit-audit-dashboard.html'));
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

app.get('/api/fruit-audit/manifest', (req, res) => {
  res.json(fruitAuditManifest);
});

app.get('/api/fruit-audit/approved-users', (req, res) => {
  res.json({
    approvedEmails: Array.from(fruitAuditApprovedEmails()).sort(),
  });
});

app.get('/dashboard', (req, res) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
  });
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

const trackerDataPath = process.env.TRACKER_DATA_PATH
  || path.join(__dirname, 'data', 'tracker-state.json');
tracker.init({ dataPath: trackerDataPath });

const fruitAuditTrackerDataPath = process.env.FRUIT_AUDIT_TRACKER_DATA_PATH
  || path.join(__dirname, 'data', 'fruit-audit-tracker-state.json');
fruitAuditTracker.init({ dataPath: fruitAuditTrackerDataPath });

app.get('/api/tracker', (req, res) => {
  res.json(tracker.getSnapshot());
});

app.get('/api/tracker/events', (req, res) => {
  tracker.subscribe(res);
});

app.post('/api/tracker/pledge', async (req, res) => {
  try {
    const { snapshot, pledge } = tracker.addPledge(req.body || {});
    const meta = tracker.getStoreMeta(pledge.storeId);
    trackerNotify.sendPledgeSignedUp(resend, {
      pledge,
      meta,
      deadline: snapshot.deadline,
      dashboardUrl: trackerDashboardUrl(req),
    }).catch(err => console.error('Tracker pledge notify:', err.message));

    res.json({
      success: true,
      message: `You are signed up for FM ${pledge.storeId}. Complete the audit in the field app and submit photos before the deadline.`,
      snapshot,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/tracker/unclaim', async (req, res) => {
  try {
    const { snapshot, pledge } = tracker.removePledge(req.body || {});
    const meta = tracker.getStoreMeta(pledge.storeId);
    trackerNotify.sendPledgeReleased(resend, {
      pledge,
      meta,
      dashboardUrl: trackerDashboardUrl(req),
    }).catch(err => console.error('Tracker unclaim notify:', err.message));

    res.json({
      success: true,
      message: `You released FM ${pledge.storeId}. The project administrator has been notified.`,
      snapshot,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/fruit-audit-tracker', (req, res) => {
  res.json(fruitAuditTracker.getSnapshot());
});

app.get('/api/fruit-audit-tracker/approved-users', (req, res) => {
  res.json({
    approvedEmails: Array.from(d1FruitAuditSignupEmails()).sort(),
  });
});

app.get('/api/fruit-audit-tracker/events', (req, res) => {
  fruitAuditTracker.subscribe(res);
});

app.post('/api/fruit-audit-tracker/pledge', async (req, res) => {
  try {
    if (!isD1FruitAuditSignupUser(req.body && req.body.email)) {
      return res.status(403).json({ error: 'This email is not approved for the District 1 fruit audit signup dashboard.' });
    }
    const { snapshot, pledge } = fruitAuditTracker.addPledge(req.body || {});
    const meta = fruitAuditTracker.getStoreMeta(pledge.storeId);
    fruitAuditTrackerNotify.sendPledgeSignedUp(resend, {
      pledge,
      meta,
      deadline: snapshot.deadline,
      dashboardUrl: fruitAuditDashboardUrl(req),
    }).catch(err => console.error('Fruit audit tracker pledge notify:', err.message));

    res.json({
      success: true,
      message: `You are signed up for FM ${pledge.storeId}. Complete the District 1 fruit audit and submit photos from the field app.`,
      snapshot,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/fruit-audit-tracker/unclaim', async (req, res) => {
  try {
    if (!isD1FruitAuditSignupUser(req.body && req.body.email)) {
      return res.status(403).json({ error: 'This email is not approved for the District 1 fruit audit signup dashboard.' });
    }
    const { snapshot, pledge } = fruitAuditTracker.removePledge(req.body || {});
    const meta = fruitAuditTracker.getStoreMeta(pledge.storeId);
    fruitAuditTrackerNotify.sendPledgeReleased(resend, {
      pledge,
      meta,
      dashboardUrl: fruitAuditDashboardUrl(req),
    }).catch(err => console.error('Fruit audit tracker release notify:', err.message));

    res.json({
      success: true,
      message: `You released FM ${pledge.storeId}. Tyson has been notified.`,
      snapshot,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/fruit-audit/send', async (req, res) => {
  const { storeId, setPhotos, comment, userName, userEmail, district } = req.body || {};
  const store = fruitAuditStores.get(padStoreId(storeId));
  const storeDistrict = store ? fruitAuditDistrict(store) : null;
  const requestedDistrict = String(district || '').trim();

  if (!isFruitAuditApprovedUser(userEmail)) {
    return res.status(403).json({ error: 'This email is not approved for the fruit audit app.' });
  }
  if (!store) {
    return res.status(400).json({ error: 'Store is not on the fruit audit list.' });
  }
  if (requestedDistrict && requestedDistrict !== storeDistrict) {
    return res.status(400).json({ error: `FM ${store.id} is assigned to District ${storeDistrict}, not District ${requestedDistrict}.` });
  }
  if (storeDistrict === '1' && !isD1FruitStoreClaimedBySubmitter(store.id, userEmail)) {
    return res.status(409).json({ error: 'Claim this District 1 store on the signup dashboard before submitting photos.' });
  }
  if (!Array.isArray(setPhotos) || !setPhotos.length) {
    return res.status(400).json({ error: 'No photos provided.' });
  }

  const submittedBySet = new Map(setPhotos.map(entry => [String(entry.setId || ''), entry]));
  const allowedSetIds = new Set(store.sets.map(set => set.id));
  const unknownSet = setPhotos.find(entry => !allowedSetIds.has(String(entry.setId || '')));
  if (unknownSet) {
    return res.status(400).json({ error: 'Submitted set is not on this store audit list.' });
  }

  const missingShots = [];
  const attachments = [];
  const photoListItems = [];
  const submittedSetIds = new Set();
  store.sets.forEach(set => {
    const entry = submittedBySet.get(set.id);
    const photos = entry && Array.isArray(entry.photos) ? entry.photos : [];
    const sidePhotos = new Map(REQUIRED_FRUIT_AUDIT_SIDES.map(side => [side.id, []]));

    photos.forEach(photo => {
      if (photo && typeof photo === 'object') {
        const sideId = String(photo.sideId || '').trim();
        if (sidePhotos.has(sideId)) sidePhotos.get(sideId).push(photo);
      }
    });

    REQUIRED_FRUIT_AUDIT_SIDES.forEach(side => {
      if (!sidePhotos.get(side.id).length) {
        missingShots.push(`${store.id} ${fruitSetLabel(set)} ${side.label}`);
      }
    });

    const hasCompleteSet = REQUIRED_FRUIT_AUDIT_SIDES.every(side => sidePhotos.get(side.id).length > 0);
    if (!hasCompleteSet) return;

    submittedSetIds.add(set.id);
    REQUIRED_FRUIT_AUDIT_SIDES.forEach(side => {
      sidePhotos.get(side.id).forEach((photo, idx) => {
        const raw = photo.base64 || photo.dataUrl || photo.photo || '';
        const base64 = String(raw || '').includes(',')
          ? String(raw).split(',').pop()
          : String(raw || '');
        const filename = fruitAttachmentName(store, set, side, idx);
        attachments.push({ filename, content: Buffer.from(base64, 'base64') });
        photoListItems.push(
          `<li style="margin:4px 0"><code>${escapeHtml(filename)}</code> - FM ${store.id}\\${escapeHtml(fruitSetFolderName(set))}\\${escapeHtml(side.label)}</li>`
        );
      });
    });
  });

  if (missingShots.length) {
    return res.status(400).json({
      error: `Missing ${missingShots.length} required 360-degree view${missingShots.length === 1 ? '' : 's'}.`,
      missingShots,
    });
  }
  if (!attachments.length) {
    return res.status(400).json({ error: 'No valid photos provided.' });
  }

  const toList = splitEmailList(process.env.FRUIT_AUDIT_RECIPIENT_EMAIL || DEFAULT_FRUIT_AUDIT_RECIPIENT);
  const ccList = splitEmailList(process.env.FRUIT_AUDIT_CC_EMAIL);
  const auditConfig = fruitAuditConfig(storeDistrict);
  addUniqueEmail(ccList, userEmail);
  const submitterName = String(userName || '').trim();
  const submitterEmail = String(userEmail || '').trim();
  const submitterLabel = [
    submitterName ? `<strong>${escapeHtml(submitterName)}</strong>` : '',
    submitterEmail ? `<a href="mailto:${escapeHtml(submitterEmail)}">${escapeHtml(submitterEmail)}</a>` : '',
  ].filter(Boolean).join(' - ');
  const submittedBy = submitterLabel
    ? `<p style="margin:0 0 16px"><strong>${attachments.length} fruit audit photo${attachments.length === 1 ? '' : 's'}</strong> from ${submitterLabel} at FM ${store.id}</p>`
    : `<p style="margin:0 0 16px"><strong>${attachments.length} fruit audit photo${attachments.length === 1 ? '' : 's'}</strong> from FM ${store.id}</p>`;

  try {
    const { data, error } = await resend.emails.send({
      from: auditConfig.from,
      to: toList,
      cc: ccList,
      subject: `${auditConfig.subjectPrefix} FM ${store.id} - ${submittedSetIds.size} sets / ${attachments.length} photos`,
      headers: {
        'X-Fruit-Audit-Subject-Trigger': auditConfig.subjectPrefix,
        'X-Fruit-Audit-District': storeDistrict,
        'X-Fruit-Audit-Store': store.id,
        'X-Fruit-Audit-Set-Count': String(store.sets.length),
        'X-Fruit-Audit-Photo-Count': String(attachments.length),
        'X-Fruit-Audit-Save-Root': auditConfig.saveRoot,
        'X-Fruit-Audit-Submitter-Name': submitterName || 'Unknown',
        'X-Fruit-Audit-Submitter-Email': submitterEmail || 'Unknown',
      },
      html: `
        <div style="font-family:sans-serif;max-width:680px">
          <h2 style="margin:0 0 8px">FM ${store.id} - District ${storeDistrict} Fruit Audit</h2>
          ${submittedBy}
          <p style="color:#666;margin:0 0 16px">Source store ${escapeHtml(store.sourceStore)} - ${submittedSetIds.size} of ${store.sets.length} set${store.sets.length === 1 ? '' : 's'} from ${escapeHtml(fruitAuditManifest.source || 'Fruit Mapping')}. Each set has a required 360-degree view: front, right side, back, and left side.</p>
          <div style="margin:0 0 16px;background:#eefbf0;border-left:4px solid #53d86a;padding:12px;border-radius:6px;color:#1b3a24;font-size:13px">
            <p style="margin:0 0 8px"><strong>Gmail poller routing prompt:</strong></p>
            <p style="margin:0 0 6px">Match subject prefix <code>${escapeHtml(auditConfig.subjectPrefix)}</code>.</p>
            <p style="margin:0 0 6px">Save raster attachments under <code>${escapeHtml(auditConfig.saveRoot)}</code>.</p>
            <p style="margin:0 0 6px">Create/use store folder <code>${store.id}</code>.</p>
            <p style="margin:0">Create/use one set folder per attachment using the filename fields: commodity, POG, produce table, and bay range. Preserve side labels in filenames.</p>
          </div>
          ${comment ? `
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Field notes:</strong></p>
          <p style="margin:0 0 16px;white-space:pre-wrap;color:#333;background:#f8f8f8;padding:12px;border-radius:6px;border-left:4px solid #53d86a">${escapeHtml(comment)}</p>
          ` : ''}
          <hr style="border:none;border-top:1px solid #ddd;margin:16px 0">
          <p style="margin:0 0 8px"><strong>Attached (${attachments.length}):</strong></p>
          <ul style="padding-left:20px;margin:0 0 16px;font-family:'JetBrains Mono',monospace;font-size:12px">${photoListItems.join('')}</ul>
          <p style="color:#888;font-size:12px;margin:0">Files are named by district, store, commodity, POG, bay range, and photo number.</p>
        </div>
      `,
      attachments
    });

    if (error) {
      console.error('Fruit audit resend error:', error);
      return res.status(400).json({ error: error.message || 'Fruit audit email send failed.' });
    }

    console.log(`Fruit audit email sent for D${storeDistrict} FM ${store.id} by ${userName || 'unknown'} (${userEmail || 'no email'}) - ${attachments.length} photo(s) - ID: ${data.id}`);
    let trackerSnapshot = null;
    if (storeDistrict === '1') {
      try {
        trackerSnapshot = fruitAuditTracker.recordCompletion({
          storeId: store.id,
          name: userName,
          email: userEmail,
          photoCount: attachments.length,
          setCount: submittedSetIds.size,
        });
      } catch (trackErr) {
        console.warn('Fruit audit tracker: could not record completion:', trackErr.message);
      }
    }
    const response = {
      success: true,
      id: data.id,
      storeId: store.id,
      district: storeDistrict,
      setCount: submittedSetIds.size,
      totalSetCount: store.sets.length,
      photoCount: attachments.length,
      recipients: { to: toList, cc: ccList }
    };
    if (storeDistrict === '1') {
      response.earnedHours = 1;
      if (trackerSnapshot) response.trackerSnapshot = trackerSnapshot;
    }
    res.json(response);
  } catch (err) {
    console.error('Fruit audit server error:', err);
    res.status(500).json({ error: err.message });
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
    try {
      tracker.recordCompletion({
        storeId: store,
        name: userName,
        email: userEmail,
        photoCount: totalPhotos,
      });
    } catch (trackErr) {
      console.warn('Tracker: could not record completion:', trackErr.message);
    }
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
