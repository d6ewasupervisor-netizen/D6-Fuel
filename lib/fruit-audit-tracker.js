const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const fruitAuditManifest = require('../data/fruit-audit-manifest.json');

const DISTRICT_ID = '1';
const REQUIRED_SIDES_PER_SET = 4;

const districtConfig = (fruitAuditManifest.districts || [])
  .find(district => String(district.id) === DISTRICT_ID);
const districtStoreOrder = districtConfig && Array.isArray(districtConfig.storeIds)
  ? districtConfig.storeIds
  : [];

const FRUIT_AUDIT_STORES = (fruitAuditManifest.stores || [])
  .filter(store => String(store.district) === DISTRICT_ID)
  .sort((a, b) => {
    const aIdx = districtStoreOrder.indexOf(a.id);
    const bIdx = districtStoreOrder.indexOf(b.id);
    if (aIdx !== -1 || bIdx !== -1) return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    return a.id.localeCompare(b.id);
  })
  .map(store => ({
    id: store.id,
    label: `FM ${store.id}`,
    district: DISTRICT_ID,
    sourceStore: store.sourceStore,
    address: store.address || null,
    routeAddress: store.address && store.address.routeAddress ? store.address.routeAddress : '',
    latitude: store.address && Number.isFinite(Number(store.address.latitude)) ? Number(store.address.latitude) : null,
    longitude: store.address && Number.isFinite(Number(store.address.longitude)) ? Number(store.address.longitude) : null,
    setCount: (store.sets || []).length,
    photoTargetCount: (store.sets || []).length * REQUIRED_SIDES_PER_SET,
  }));

const STORE_IDS = new Set(FRUIT_AUDIT_STORES.map(store => store.id));

const bus = new EventEmitter();
bus.setMaxListeners(100);

const DEFAULT_DEADLINE_ISO = '2026-06-19T17:00:00-07:00';
const PREVIOUS_DEFAULT_DEADLINE_ISOS = new Set([
  '2026-06-13T17:00:00-07:00',
  '2026-06-12T19:00:00-07:00',
  '2026-06-19T23:59:59-07:00',
]);
const DEFAULT_COMPLETION_ROOT = String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D1`;
const REQUIRED_DESTINATION_SIDE_PREFIXES = ['Front', 'Right_Side', 'Back', 'Left_Side'];
const SEEDED_COMPLETE_STORES = new Set([
  '220',
  ...String(process.env.FRUIT_AUDIT_TRACKER_COMPLETE_STORES || '')
    .split(/[,\s]+/)
    .map(padStoreId)
    .filter(Boolean),
]);
const AUDIT_DAY_LABELS = {
  '2026-06-15': 'Mon 6/15',
  '2026-06-16': 'Tue 6/16',
  '2026-06-17': 'Wed 6/17',
  '2026-06-18': 'Thu 6/18',
};
const DEFAULT_D1_ASSIGNMENTS = [
  { storeId: '035', name: 'Julie Ferguson', email: 'julie.ferguson@retailodyssey.com', scheduledDates: ['2026-06-16'] },
  { storeId: '040', name: 'Julie Ferguson', email: 'julie.ferguson@retailodyssey.com', scheduledDates: ['2026-06-18'] },
  { storeId: '060', name: 'Cindi Griggs', email: 'cindi.griggs@retailodyssey.com', scheduledDates: ['2026-06-16'] },
  { storeId: '063', name: 'Angelina Iniguez Carrillo', email: 'kalleen.iniguezcarri@retailodyssey.com', scheduledDates: ['2026-06-15'] },
  { storeId: '143', name: 'Cindi Griggs', email: 'cindi.griggs@retailodyssey.com', scheduledDates: ['2026-06-15'] },
  { storeId: '153', name: 'Angelina Iniguez Carrillo', email: 'kalleen.iniguezcarri@retailodyssey.com', scheduledDates: ['2026-06-16'] },
  { storeId: '218', name: 'Jennifer Russell', email: 'jennifer.russell@sasretailservices.com', scheduledDates: ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'] },
  { storeId: '220', name: 'Victor Trevino Gonzalez', email: 'victor.trevino@retailodyssey.com', scheduledDates: ['2026-06-17'] },
  { storeId: '240', name: 'Angelina Iniguez Carrillo', email: 'kalleen.iniguezcarri@retailodyssey.com', scheduledDates: ['2026-06-18'] },
  { storeId: '242', name: 'Michelle Sweet', email: 'michelle.sweet@youradv.com', scheduledDates: ['2026-06-17', '2026-06-18'] },
  { storeId: '285', name: 'Julie Ferguson', email: 'julie.ferguson@retailodyssey.com', scheduledDates: ['2026-06-15'] },
  { storeId: '375', name: 'Victor Trevino Gonzalez', email: 'victor.trevino@retailodyssey.com', scheduledDates: ['2026-06-15'] },
  { storeId: '377', name: 'Kimberlee SanchezCanastuj', email: 'kim.sanchezcanastuj@retailodyssey.com', scheduledDates: ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'] },
  { storeId: '393', name: 'Victor Trevino Gonzalez', email: 'victor.trevino@retailodyssey.com', scheduledDates: ['2026-06-18'] },
  { storeId: '462', name: 'Tamera Sandeno', email: 'tamera.sandeno@retailodyssey.com', scheduledDates: ['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'] },
  { storeId: '482', name: 'Julie Ferguson', email: 'julie.ferguson@retailodyssey.com', scheduledDates: ['2026-06-17'] },
  { storeId: '516', name: 'Victor Trevino Gonzalez', email: 'victor.trevino@retailodyssey.com', scheduledDates: ['2026-06-16'] },
  { storeId: '651', name: 'Michelle Sweet', email: 'michelle.sweet@youradv.com', scheduledDates: ['2026-06-15', '2026-06-16'] },
  { storeId: '661', name: 'Omar Robles', email: 'omar.robles@retailodyssey.com', scheduledDates: ['2026-06-16'] },
  { storeId: '694', name: 'Angelina Iniguez Carrillo', email: 'kalleen.iniguezcarri@retailodyssey.com', scheduledDates: ['2026-06-17'] },
];
const DEFAULT_D1_ASSIGNMENTS_BY_STORE = new Map(DEFAULT_D1_ASSIGNMENTS.map(assignment => [assignment.storeId, assignment]));
const DEFAULT_ASSIGNMENT_PLEDGED_AT = '2026-06-15T20:21:00.000Z';

let state = null;
let dataPath = null;
let completionRoot = null;

function padStoreId(storeId) {
  const digits = String(storeId || '').replace(/\D/g, '');
  if (!digits) return null;
  const id = digits.padStart(3, '0');
  return STORE_IDS.has(id) ? id : null;
}

function defaultDeadline() {
  if (process.env.FRUIT_AUDIT_TRACKER_DEADLINE_ISO) {
    return process.env.FRUIT_AUDIT_TRACKER_DEADLINE_ISO;
  }
  return DEFAULT_DEADLINE_ISO;
}

function completionSourceRoot() {
  return process.env.FRUIT_AUDIT_D1_COMPLETION_ROOT || completionRoot || DEFAULT_COMPLETION_ROOT;
}

function emptyState() {
  return {
    deadline: defaultDeadline(),
    pledges: [],
    completions: {},
    optedOutEmails: [],
    updatedAt: new Date().toISOString(),
  };
}

function loadState() {
  if (!dataPath) return emptyState();
  try {
    if (fs.existsSync(dataPath)) {
      const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      return {
        ...emptyState(),
        ...raw,
        pledges: Array.isArray(raw.pledges) ? raw.pledges : [],
        completions: raw.completions && typeof raw.completions === 'object' ? raw.completions : {},
        optedOutEmails: Array.isArray(raw.optedOutEmails) ? raw.optedOutEmails : [],
      };
    }
  } catch (err) {
    console.warn('Fruit audit tracker: could not load state, starting fresh:', err.message);
  }
  return emptyState();
}

function persist() {
  if (!dataPath) return;
  try {
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dataPath, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Fruit audit tracker: failed to persist state:', err.message);
  }
}

function cleanFolderPart(value) {
  return String(value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Unknown';
}

function titleFromToken(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function commodityName(set) {
  const withoutNumber = String(set.commodityGroup || '')
    .replace(new RegExp(`^${set.commodity}\\s*[-_\\s]*`, 'i'), '');
  return titleFromToken(withoutNumber) || `C${set.commodity}`;
}

function expectedDestinationFolderName(set) {
  return cleanFolderPart([
    `${set.commodity} ${commodityName(set)}`,
    `POG${set.pogDbKey}`,
    titleFromToken(String(set.aisleDesc || '').replace(/[^A-Za-z0-9]+/g, '_')),
    `Bays${String(set.bayRange || '').replace(/[^0-9A-Za-z]+/g, '-').replace(/^-+|-+$/g, '')}`,
  ].join(' - '));
}

function findChildDirectory(parentDir, expectedName) {
  try {
    const entries = fs.readdirSync(parentDir, { withFileTypes: true });
    const expected = String(expectedName || '').toLowerCase();
    const hit = entries.find(entry => entry.isDirectory() && entry.name.toLowerCase() === expected);
    return hit ? path.join(parentDir, hit.name) : null;
  } catch (err) {
    return null;
  }
}

function jpgFilesWithStats(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /\.jpe?g$/i.test(entry.name))
      .map(entry => {
        const filePath = path.join(dir, entry.name);
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(filePath).mtimeMs;
        } catch (err) {}
        return { name: entry.name, mtimeMs };
      });
  } catch (err) {
    return [];
  }
}

function destinationSetStatus(storeDir, set) {
  const setDir = findChildDirectory(storeDir, expectedDestinationFolderName(set));
  if (!setDir) return { complete: false, photoCount: 0, latestMtimeMs: 0 };
  const files = jpgFilesWithStats(setDir);
  const complete = REQUIRED_DESTINATION_SIDE_PREFIXES.every(prefix => (
    files.some(file => file.name.toLowerCase().startsWith(prefix.toLowerCase()))
  ));
  return {
    complete,
    photoCount: files.length,
    latestMtimeMs: files.reduce((latest, file) => Math.max(latest, file.mtimeMs || 0), 0),
  };
}

function destinationCompletionForStore(meta) {
  const root = completionSourceRoot();
  const storeDir = findChildDirectory(root, meta.id);
  if (!storeDir) return null;
  const manifestStore = (fruitAuditManifest.stores || []).find(store => store.id === meta.id);
  const sets = manifestStore && Array.isArray(manifestStore.sets) ? manifestStore.sets : [];
  if (!sets.length) return null;

  const statuses = sets.map(set => destinationSetStatus(storeDir, set));
  if (!statuses.every(status => status.complete)) return null;
  const latestMtimeMs = statuses.reduce((latest, status) => Math.max(latest, status.latestMtimeMs || 0), 0);
  return {
    storeId: meta.id,
    name: 'Destination folder',
    email: '',
    photoCount: statuses.reduce((sum, status) => sum + status.photoCount, 0),
    setCount: sets.length,
    completedAt: latestMtimeMs ? new Date(latestMtimeMs).toISOString() : new Date().toISOString(),
    source: 'destination-folder',
  };
}

function seededCompletionForStore(storeId) {
  const meta = getStoreMeta(storeId);
  return {
    storeId,
    name: 'Marked complete',
    email: '',
    photoCount: Number(meta.photoTargetCount) || Number(meta.setCount || 0) * REQUIRED_SIDES_PER_SET,
    setCount: Number(meta.setCount) || 0,
    completedAt: new Date().toISOString(),
    source: 'manual-seed',
  };
}

function seededPledgeId(storeId, email) {
  return `seeded_${storeId}_${normalizeEmail(email).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function scheduledLabelForDates(dates) {
  return (Array.isArray(dates) ? dates : [])
    .map(date => AUDIT_DAY_LABELS[date] || date)
    .filter(Boolean)
    .join(', ');
}

function assignmentScheduleFields(assignment) {
  const scheduledDates = Array.isArray(assignment.scheduledDates)
    ? assignment.scheduledDates.filter(Boolean)
    : [];
  return {
    scheduledDates,
    scheduledLabel: scheduledLabelForDates(scheduledDates),
  };
}

function seededPledgeForAssignment(assignment) {
  const storeId = padStoreId(assignment.storeId);
  if (!storeId) return null;
  return {
    id: seededPledgeId(storeId, assignment.email),
    storeId,
    name: String(assignment.name || '').trim(),
    email: String(assignment.email || '').trim(),
    pledgedAt: DEFAULT_ASSIGNMENT_PLEDGED_AT,
    ...assignmentScheduleFields(assignment),
    source: 'default-assignment',
  };
}

function applyAssignmentSchedule(target, assignment) {
  if (!target || !assignment) return false;
  const fields = assignmentScheduleFields(assignment);
  let changed = false;
  if (JSON.stringify(target.scheduledDates || []) !== JSON.stringify(fields.scheduledDates)) {
    target.scheduledDates = fields.scheduledDates;
    changed = true;
  }
  if ((target.scheduledLabel || '') !== fields.scheduledLabel) {
    target.scheduledLabel = fields.scheduledLabel;
    changed = true;
  }
  return changed;
}

function syncDerivedCompletions({ persistChanges = false } = {}) {
  if (!state) return false;
  let changed = false;
  const derived = [
    ...Array.from(SEEDED_COMPLETE_STORES).map(seededCompletionForStore),
    ...FRUIT_AUDIT_STORES
      .map(destinationCompletionForStore)
      .filter(Boolean),
  ];

  for (const entry of derived) {
    if (!entry || !entry.storeId || state.completions[entry.storeId]) continue;
    state.completions[entry.storeId] = entry;
    changed = true;
  }

  if (changed) {
    state.updatedAt = new Date().toISOString();
    if (persistChanges) persist();
  }
  return changed;
}

function syncDefaultAssignments({ persistChanges = false } = {}) {
  if (!state) return false;
  let changed = false;
  const optedOutEmails = new Set((state.optedOutEmails || []).map(normalizeEmail));

  for (const assignment of DEFAULT_D1_ASSIGNMENTS) {
    const pledge = seededPledgeForAssignment(assignment);
    if (!pledge || !pledge.storeId || isStoreComplete(pledge.storeId)) continue;
    const existing = activePledgeForStore(pledge.storeId);
    if (existing) {
      if (normalizeEmail(existing.email) === normalizeEmail(pledge.email)) {
        changed = applyAssignmentSchedule(existing, assignment) || changed;
      }
      continue;
    }
    if (!pledge.scheduledDates.length && optedOutEmails.has(normalizeEmail(pledge.email))) continue;
    state.pledges.push(pledge);
    changed = true;
  }

  if (changed) {
    state.updatedAt = new Date().toISOString();
    if (persistChanges) persist();
  }
  return changed;
}

function broadcast() {
  const snapshot = buildSnapshot();
  bus.emit('update', snapshot);
  return snapshot;
}

function init(options = {}) {
  dataPath = options.dataPath || path.join(process.cwd(), 'data', 'fruit-audit-tracker-state.json');
  completionRoot = options.completionRoot || null;
  state = loadState();
  if (!state.deadline || PREVIOUS_DEFAULT_DEADLINE_ISOS.has(state.deadline)) {
    state.deadline = defaultDeadline();
    persist();
  }
  syncDerivedCompletions({ persistChanges: true });
  syncDefaultAssignments({ persistChanges: true });
  return state;
}

function pledgeId() {
  return `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isStoreComplete(storeId) {
  return Boolean(state.completions[storeId]);
}

function activePledgeForStore(storeId) {
  return state.pledges.find(pledge => pledge.storeId === storeId && !isStoreComplete(storeId));
}

function isScheduledAssignment(pledge) {
  return Array.isArray(pledge && pledge.scheduledDates) && pledge.scheduledDates.length > 0;
}

function addPledge({ name, email, storeId }) {
  const store = padStoreId(storeId);
  if (!store) throw new Error('Invalid District 1 fruit store number.');

  const trimmedName = String(name || '').trim();
  const trimmedEmail = String(email || '').trim();
  if (trimmedName.length < 2) throw new Error('Please enter your full name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new Error('Please enter a valid email address.');
  }

  if (isStoreComplete(store)) {
    throw new Error(`FM ${store} is already complete.`);
  }

  const existing = activePledgeForStore(store);
  if (existing) {
    throw new Error(`FM ${store} is already assigned to ${existing.name}. Pick another store or contact Tyson.`);
  }

  const pledge = {
    id: pledgeId(),
    storeId: store,
    name: trimmedName,
    email: trimmedEmail,
    pledgedAt: new Date().toISOString(),
  };

  state.optedOutEmails = (state.optedOutEmails || [])
    .filter(email => normalizeEmail(email) !== normalizeEmail(trimmedEmail));
  state.pledges.push(pledge);
  state.updatedAt = new Date().toISOString();
  persist();
  return { snapshot: broadcast(), pledge };
}

function removePledge({ pledgeId, email }) {
  const id = String(pledgeId || '').trim();
  if (!id) throw new Error('Missing assignment id.');

  const trimmedEmail = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new Error('Enter the same email you used when you were assigned the store.');
  }

  const idx = state.pledges.findIndex(pledge => pledge.id === id);
  if (idx === -1) throw new Error('Assignment not found. It may have already been released.');

  const pledge = state.pledges[idx];
  if (normalizeEmail(pledge.email) !== normalizeEmail(trimmedEmail)) {
    throw new Error('You can only release a store assigned to this email address.');
  }

  if (isScheduledAssignment(pledge)) {
    throw new Error('Scheduled District 1 audit assignments cannot be released from the dashboard. Contact Tyson if the schedule needs to change.');
  }

  if (isStoreComplete(pledge.storeId)) {
    throw new Error(`FM ${pledge.storeId} is already complete and cannot be released.`);
  }

  state.pledges.splice(idx, 1);
  state.updatedAt = new Date().toISOString();
  persist();
  return { snapshot: broadcast(), pledge };
}

function removePledgesForEmail({ email }) {
  const trimmedEmail = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new Error('Enter the same email you used when you were assigned the store.');
  }

  const emailKey = normalizeEmail(trimmedEmail);
  const releasedPledges = [];
  state.pledges = state.pledges.filter(pledge => {
    const shouldRelease = normalizeEmail(pledge.email) === emailKey
      && !isScheduledAssignment(pledge)
      && !isStoreComplete(pledge.storeId);
    if (shouldRelease) releasedPledges.push(pledge);
    return !shouldRelease;
  });

  if (!releasedPledges.length) {
    const hasScheduledAssignment = state.pledges.some(pledge => (
      normalizeEmail(pledge.email) === emailKey
      && isScheduledAssignment(pledge)
      && !isStoreComplete(pledge.storeId)
    ));
    if (hasScheduledAssignment) {
      throw new Error('Scheduled District 1 audit assignments cannot be released from the dashboard. Contact Tyson if the schedule needs to change.');
    }
    throw new Error('No active District 1 fruit audit assignments found for this email.');
  }

  if (!(state.optedOutEmails || []).some(email => normalizeEmail(email) === emailKey)) {
    state.optedOutEmails = [...(state.optedOutEmails || []), trimmedEmail];
  }
  state.updatedAt = new Date().toISOString();
  persist();
  return { snapshot: broadcast(), pledges: releasedPledges };
}

function getStoreMeta(storeId) {
  return FRUIT_AUDIT_STORES.find(store => store.id === storeId) || { id: storeId, label: `FM ${storeId}`, district: DISTRICT_ID };
}

function recordCompletion({ storeId, name, email, photoCount, setCount }) {
  const store = padStoreId(storeId);
  if (!store) return null;

  const entry = {
    storeId: store,
    name: String(name || '').trim() || 'Unknown',
    email: String(email || '').trim(),
    photoCount: Number(photoCount) || 0,
    setCount: Number(setCount) || 0,
    completedAt: new Date().toISOString(),
  };

  state.completions[store] = entry;
  state.updatedAt = new Date().toISOString();
  persist();
  return broadcast();
}

function buildSnapshot() {
  syncDerivedCompletions({ persistChanges: true });
  syncDefaultAssignments({ persistChanges: true });
  const now = Date.now();
  const deadlineMs = Date.parse(state.deadline);
  const stores = FRUIT_AUDIT_STORES.map(meta => {
    const completion = state.completions[meta.id] || null;
    const pledge = state.pledges.find(item => item.storeId === meta.id) || null;
    const assignment = DEFAULT_D1_ASSIGNMENTS_BY_STORE.get(meta.id) || null;
    let status = 'open';
    if (completion) status = 'complete';
    else if (pledge) status = 'pledged';

    return {
      ...meta,
      scheduledDates: pledge && !completion
        ? pledge.scheduledDates || []
        : assignmentScheduleFields(assignment || {}).scheduledDates,
      scheduledLabel: pledge && !completion
        ? pledge.scheduledLabel || ''
        : assignmentScheduleFields(assignment || {}).scheduledLabel,
      status,
      pledge: pledge && !completion ? pledge : null,
      completion,
    };
  });

  const completeCount = stores.filter(store => store.status === 'complete').length;
  const pledgedCount = stores.filter(store => store.status === 'pledged').length;
  const openCount = stores.filter(store => store.status === 'open').length;
  const completedByEmail = {};
  stores.forEach(store => {
    if (!store.completion) return;
    const email = String(store.completion.email || '').trim();
    const key = email.toLowerCase() || `system:${store.id}`;
    if (!key) return;
    if (!completedByEmail[key]) {
      completedByEmail[key] = {
        name: store.completion.name || 'Unknown',
        email,
        completed: 0,
        stores: [],
      };
    }
    completedByEmail[key].completed += 1;
    completedByEmail[key].stores.push(store.id);
  });
  const completedBy = Object.values(completedByEmail)
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));

  return {
    project: 'District 1 Fruit Audit',
    district: DISTRICT_ID,
    deadline: state.deadline,
    deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : null,
    nowMs: now,
    stores,
    pledges: [...state.pledges].sort((a, b) => a.storeId.localeCompare(b.storeId)),
    completions: state.completions,
    optedOutEmails: [...(state.optedOutEmails || [])],
    completedBy,
    stats: {
      total: stores.length,
      complete: completeCount,
      pledged: pledgedCount,
      open: openCount,
      remaining: stores.length - completeCount,
      totalSets: stores.reduce((sum, store) => sum + store.setCount, 0),
      totalPhotoTargets: stores.reduce((sum, store) => sum + store.photoTargetCount, 0),
    },
    updatedAt: state.updatedAt,
  };
}

function getSnapshot() {
  return buildSnapshot();
}

function subscribe(res) {
  const snapshot = buildSnapshot();
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

  const onUpdate = data => {
    res.write(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`);
  };

  bus.on('update', onUpdate);
  res.on('close', () => bus.off('update', onUpdate));
}

module.exports = {
  DISTRICT_ID,
  FRUIT_AUDIT_STORES,
  STORE_IDS,
  init,
  getSnapshot,
  addPledge,
  removePledge,
  removePledgesForEmail,
  getStoreMeta,
  recordCompletion,
  subscribe,
  padStoreId,
};
