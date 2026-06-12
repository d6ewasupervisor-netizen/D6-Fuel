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
    setCount: (store.sets || []).length,
    photoTargetCount: (store.sets || []).length * REQUIRED_SIDES_PER_SET,
  }));

const STORE_IDS = new Set(FRUIT_AUDIT_STORES.map(store => store.id));

const bus = new EventEmitter();
bus.setMaxListeners(100);

const DEFAULT_DEADLINE_ISO = '2026-06-12T19:00:00-07:00';
const PREVIOUS_DEFAULT_DEADLINE_ISO = '2026-06-19T23:59:59-07:00';

let state = null;
let dataPath = null;

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

function broadcast() {
  const snapshot = buildSnapshot();
  bus.emit('update', snapshot);
  return snapshot;
}

function init(options = {}) {
  dataPath = options.dataPath || path.join(process.cwd(), 'data', 'fruit-audit-tracker-state.json');
  state = loadState();
  if (!state.deadline || state.deadline === PREVIOUS_DEFAULT_DEADLINE_ISO) {
    state.deadline = defaultDeadline();
    persist();
  }
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
    throw new Error(`FM ${store} is already claimed by ${existing.name}. Pick another store or contact Tyson.`);
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
  if (!id) throw new Error('Missing claim id.');

  const trimmedEmail = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new Error('Enter the same email you used when you claimed the store.');
  }

  const idx = state.pledges.findIndex(pledge => pledge.id === id);
  if (idx === -1) throw new Error('Claim not found. It may have already been released.');

  const pledge = state.pledges[idx];
  if (normalizeEmail(pledge.email) !== normalizeEmail(trimmedEmail)) {
    throw new Error('You can only release a store you claimed with this email address.');
  }

  if (isStoreComplete(pledge.storeId)) {
    throw new Error(`FM ${pledge.storeId} is already complete and cannot be unclaimed.`);
  }

  state.pledges.splice(idx, 1);
  state.updatedAt = new Date().toISOString();
  persist();
  return { snapshot: broadcast(), pledge };
}

function removePledgesForEmail({ email }) {
  const trimmedEmail = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new Error('Enter the same email you used when you claimed the store.');
  }

  const emailKey = normalizeEmail(trimmedEmail);
  const releasedPledges = [];
  state.pledges = state.pledges.filter(pledge => {
    const shouldRelease = normalizeEmail(pledge.email) === emailKey && !isStoreComplete(pledge.storeId);
    if (shouldRelease) releasedPledges.push(pledge);
    return !shouldRelease;
  });

  if (!releasedPledges.length) {
    throw new Error('No active District 1 fruit audit claims found for this email.');
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
  const now = Date.now();
  const deadlineMs = Date.parse(state.deadline);
  const stores = FRUIT_AUDIT_STORES.map(meta => {
    const completion = state.completions[meta.id] || null;
    const pledge = state.pledges.find(item => item.storeId === meta.id) || null;
    let status = 'open';
    if (completion) status = 'complete';
    else if (pledge) status = 'pledged';

    return {
      ...meta,
      status,
      pledge: pledge && !completion ? pledge : null,
      completion,
    };
  });

  const completeCount = stores.filter(store => store.status === 'complete').length;
  const pledgedCount = stores.filter(store => store.status === 'pledged').length;
  const openCount = stores.filter(store => store.status === 'open').length;
  const hoursByEmail = {};
  stores.forEach(store => {
    if (!store.completion || !store.completion.email) return;
    const key = store.completion.email.trim().toLowerCase();
    if (!key) return;
    if (!hoursByEmail[key]) {
      hoursByEmail[key] = {
        name: store.completion.name || 'Unknown',
        email: store.completion.email,
        hours: 0,
        stores: [],
      };
    }
    hoursByEmail[key].hours += 1;
    hoursByEmail[key].stores.push(store.id);
  });
  const hours = Object.values(hoursByEmail)
    .sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

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
    hours,
    stats: {
      total: stores.length,
      complete: completeCount,
      pledged: pledgedCount,
      open: openCount,
      remaining: stores.length - completeCount,
      earnedHours: completeCount,
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
