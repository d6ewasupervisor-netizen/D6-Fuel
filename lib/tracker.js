const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const AUDIT_STORES = [
  { id: '049', city: "Coeur d'Alene", state: 'ID' },
  { id: '053', city: 'Covington', state: 'WA' },
  { id: '214', city: 'Spokane', state: 'WA' },
  { id: '286', city: 'Richland', state: 'WA' },
  { id: '351', city: 'Spokane Valley', state: 'WA' },
  { id: '486', city: 'Yakima', state: 'WA' },
  { id: '652', city: 'Ellensburg', state: 'WA' },
  { id: '657', city: 'Spokane', state: 'WA' },
];

const STORE_IDS = new Set(AUDIT_STORES.map(s => s.id));

const bus = new EventEmitter();
bus.setMaxListeners(100);

let state = null;
let dataPath = null;

function padStoreId(storeId) {
  const digits = String(storeId || '').replace(/\D/g, '');
  if (!digits) return null;
  const id = digits.padStart(3, '0');
  return STORE_IDS.has(id) ? id : null;
}

function defaultDeadline() {
  if (process.env.TRACKER_DEADLINE_ISO) {
    return process.env.TRACKER_DEADLINE_ISO;
  }
  // EOD Thursday May 21, 2026 Pacific (project audit week)
  return '2026-05-21T23:59:59-07:00';
}

function emptyState() {
  return {
    deadline: defaultDeadline(),
    pledges: [],
    completions: {},
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
      };
    }
  } catch (err) {
    console.warn('Tracker: could not load state, starting fresh:', err.message);
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
    console.error('Tracker: failed to persist state:', err.message);
  }
}

function broadcast() {
  const snapshot = buildSnapshot();
  bus.emit('update', snapshot);
  return snapshot;
}

function init(options = {}) {
  dataPath = options.dataPath || path.join(process.cwd(), 'data', 'tracker-state.json');
  state = loadState();
  state.deadline = state.deadline || defaultDeadline();
  return state;
}

function pledgeId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isStoreComplete(storeId) {
  return Boolean(state.completions[storeId]);
}

function activePledgeForStore(storeId) {
  return state.pledges.find(p => p.storeId === storeId && !isStoreComplete(storeId));
}

function addPledge({ name, email, storeId }) {
  const store = padStoreId(storeId);
  if (!store) throw new Error('Invalid store number.');

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
    throw new Error(`FM ${store} is already claimed by ${existing.name}. Pick another store or contact the project administrator.`);
  }

  const pledge = {
    id: pledgeId(),
    storeId: store,
    name: trimmedName,
    email: trimmedEmail,
    pledgedAt: new Date().toISOString(),
  };

  state.pledges.push(pledge);
  state.updatedAt = new Date().toISOString();
  persist();
  return broadcast();
}

function recordCompletion({ storeId, name, email, photoCount }) {
  const store = padStoreId(storeId);
  if (!store) return null;

  const entry = {
    storeId: store,
    name: String(name || '').trim() || 'Unknown',
    email: String(email || '').trim(),
    photoCount: Number(photoCount) || 0,
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
  const stores = AUDIT_STORES.map(meta => {
    const completion = state.completions[meta.id] || null;
    const pledge = state.pledges.find(p => p.storeId === meta.id) || null;
    let status = 'open';
    if (completion) status = 'complete';
    else if (pledge) status = 'pledged';

    return {
      ...meta,
      label: `FM ${meta.id}`,
      status,
      pledge: pledge && !completion ? pledge : null,
      completion,
    };
  });

  const completeCount = stores.filter(s => s.status === 'complete').length;
  const pledgedCount = stores.filter(s => s.status === 'pledged').length;
  const openCount = stores.filter(s => s.status === 'open').length;

  return {
    deadline: state.deadline,
    deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : null,
    nowMs: now,
    stores,
    pledges: [...state.pledges].sort((a, b) => a.storeId.localeCompare(b.storeId)),
    completions: state.completions,
    stats: {
      total: stores.length,
      complete: completeCount,
      pledged: pledgedCount,
      open: openCount,
      remaining: stores.length - completeCount,
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
  reqOnClose(res, () => bus.off('update', onUpdate));
}

function reqOnClose(res, fn) {
  res.on('close', fn);
}

module.exports = {
  AUDIT_STORES,
  STORE_IDS,
  init,
  getSnapshot,
  addPledge,
  recordCompletion,
  subscribe,
  padStoreId,
};
