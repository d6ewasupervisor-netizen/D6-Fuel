const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const fruitAuditManifest = require('../data/fruit-audit-manifest.json');
const prodAssignments = require('../data/fruit-audit-prod-assignments-p05w4.json');

const REQUIRED_SIDES_PER_SET = 4;
const TRACKED_DISTRICTS = new Set(['1', '6', '7', '8']);
const DEFAULT_DEADLINE_ISO = '2026-06-19T17:00:00-07:00';
const PREVIOUS_DEFAULT_DEADLINE_ISOS = new Set([
  '2026-06-13T17:00:00-07:00',
  '2026-06-12T19:00:00-07:00',
  '2026-06-19T23:59:59-07:00',
]);
const DEFAULT_ASSIGNMENT_PLEDGED_AT = '2026-06-15T20:21:00.000Z';
const REQUIRED_DESTINATION_SIDE_PREFIXES = ['Front', 'Right_Side', 'Back', 'Left_Side'];
const DEFAULT_COMPLETION_ROOTS = {
  '1': String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D1`,
  '6': String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D6`,
  '7': String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D7`,
  '8': String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D8`,
};
const DEFAULT_D8_ASSIGNMENTS = [
  { storeId: '023', name: 'Aiyana Natarisalazar', email: 'aiyana.natarisalazar@retailodyssey.com' },
];
const SEED_STATE_FILES = {
  '1': path.join(__dirname, '..', 'data', 'fruit-audit-tracker-state.seed.json'),
  '8': path.join(__dirname, '..', 'data', 'fruit-audit-tracker-state-d8.seed.json'),
};
const DEFAULT_SEEDED_COMPLETE_STORES = {
  '1': ['220'],
};

const AUDIT_DAY_LABELS = {
  '2026-06-14': 'Sun 6/14',
  '2026-06-15': 'Mon 6/15',
  '2026-06-16': 'Tue 6/16',
  '2026-06-17': 'Wed 6/17',
  '2026-06-18': 'Thu 6/18',
  '2026-06-19': 'Fri 6/19',
  '2026-06-20': 'Sat 6/20',
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

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function padAnyStoreId(storeId) {
  const digits = String(storeId || '').replace(/\D/g, '');
  return digits ? digits.padStart(3, '0') : null;
}

function scheduledLabelForDates(dates) {
  return (Array.isArray(dates) ? dates : [])
    .map(date => AUDIT_DAY_LABELS[date] || date)
    .filter(Boolean)
    .join(', ');
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

function assignmentId(storeId, email) {
  return `seeded_${storeId}_${normalizeEmail(email).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function completionStorageKey(storeId, email) {
  const store = padAnyStoreId(storeId);
  const normalized = normalizeEmail(email);
  return store && normalized ? `${store}::${normalized}` : store;
}

function prodDistrictAssignments() {
  return (prodAssignments.assignments || []).flatMap(storeAssignment => {
    const district = String(storeAssignment.district || '');
    const storeId = padAnyStoreId(storeAssignment.storeId);
    return (storeAssignment.leadAssignments || [])
      .filter(lead => storeId && lead && lead.email)
      .map(lead => ({
        district,
        storeId,
        name: lead.name,
        email: lead.email,
        scheduledDates: Array.isArray(lead.scheduledDates) ? lead.scheduledDates : [],
        scheduledLabel: lead.scheduledLabel || scheduledLabelForDates(lead.scheduledDates),
        source: 'sas-prod',
        visitIds: lead.visitIds || [],
        shiftIds: lead.shiftIds || [],
      }));
  });
}

const ASSIGNMENTS = [
  ...DEFAULT_D1_ASSIGNMENTS.map(assignment => ({ ...assignment, district: '1', source: 'static-d1' })),
  ...DEFAULT_D8_ASSIGNMENTS.map(assignment => ({ ...assignment, district: '8', source: 'static-d8' })),
  ...prodDistrictAssignments(),
];

function assignmentsForDistrict(districtId) {
  return ASSIGNMENTS.filter(assignment => String(assignment.district) === String(districtId));
}

function allAssignmentEmails() {
  return [...new Set(ASSIGNMENTS.map(assignment => normalizeEmail(assignment.email)).filter(Boolean))];
}

function trackedDistrictIds() {
  return [...TRACKED_DISTRICTS];
}

class DistrictFruitAuditTracker {
  constructor(districtId, options = {}) {
    this.districtId = String(districtId);
    this.dataPath = options.dataPath;
    this.completionRoot = options.completionRoot || DEFAULT_COMPLETION_ROOTS[this.districtId] || null;
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(100);
    this.state = null;
    this.stores = this.buildStores();
    this.storeIds = new Set(this.stores.map(store => store.id));
    this.defaultAssignments = assignmentsForDistrict(this.districtId);
    this.defaultAssignmentsByStore = this.defaultAssignments.reduce((acc, assignment) => {
      if (!acc[assignment.storeId]) acc[assignment.storeId] = [];
      acc[assignment.storeId].push(assignment);
      return acc;
    }, {});
    this.seededCompleteStores = this.buildSeededCompleteStores();
  }

  buildStores() {
    const districtConfig = (fruitAuditManifest.districts || [])
      .find(district => String(district.id) === this.districtId);
    const districtStoreOrder = districtConfig && Array.isArray(districtConfig.storeIds)
      ? districtConfig.storeIds
      : [];
    const seen = new Set();
    return (fruitAuditManifest.stores || [])
      .filter(store => String(store.district) === this.districtId)
      .filter(store => {
        const key = `${store.id}:${store.district}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        const aIdx = districtStoreOrder.indexOf(a.id);
        const bIdx = districtStoreOrder.indexOf(b.id);
        if (aIdx !== -1 || bIdx !== -1) return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
        return a.id.localeCompare(b.id);
      })
      .map(store => ({
        id: store.id,
        label: `FM ${store.id}`,
        district: this.districtId,
        sourceStore: store.sourceStore,
        address: store.address || null,
        routeAddress: store.address && store.address.routeAddress ? store.address.routeAddress : '',
        latitude: store.address && Number.isFinite(Number(store.address.latitude)) ? Number(store.address.latitude) : null,
        longitude: store.address && Number.isFinite(Number(store.address.longitude)) ? Number(store.address.longitude) : null,
        setCount: (store.sets || []).length,
        photoTargetCount: (store.sets || []).length * REQUIRED_SIDES_PER_SET,
      }));
  }

  buildSeededCompleteStores() {
    const configured = String(process.env[`FRUIT_AUDIT_D${this.districtId}_TRACKER_COMPLETE_STORES`] || '')
      .split(/[,\s]+/)
      .map(padAnyStoreId)
      .filter(storeId => storeId && this.storeIds.has(storeId));
    const defaults = (DEFAULT_SEEDED_COMPLETE_STORES[this.districtId] || [])
      .filter(storeId => this.storeIds.has(storeId));
    return new Set([...defaults, ...configured]);
  }

  padStoreId(storeId) {
    const id = padAnyStoreId(storeId);
    return id && this.storeIds.has(id) ? id : null;
  }

  defaultDeadline() {
    return process.env[`FRUIT_AUDIT_D${this.districtId}_TRACKER_DEADLINE_ISO`]
      || process.env.FRUIT_AUDIT_TRACKER_DEADLINE_ISO
      || DEFAULT_DEADLINE_ISO;
  }

  emptyState() {
    return {
      deadline: this.defaultDeadline(),
      pledges: [],
      completions: {},
      optedOutEmails: [],
      assignmentRequests: [],
      updatedAt: new Date().toISOString(),
    };
  }

  loadState() {
    if (!this.dataPath) return this.emptyState();
    try {
      if (fs.existsSync(this.dataPath)) {
        const raw = JSON.parse(fs.readFileSync(this.dataPath, 'utf8'));
        return {
          ...this.emptyState(),
          ...raw,
          pledges: Array.isArray(raw.pledges) ? raw.pledges : [],
          completions: raw.completions && typeof raw.completions === 'object' ? raw.completions : {},
          optedOutEmails: Array.isArray(raw.optedOutEmails) ? raw.optedOutEmails : [],
          assignmentRequests: Array.isArray(raw.assignmentRequests) ? raw.assignmentRequests : [],
        };
      }
      const seedPath = SEED_STATE_FILES[this.districtId];
      if (seedPath && fs.existsSync(seedPath)) {
        const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
        return {
          ...this.emptyState(),
          ...seed,
          pledges: Array.isArray(seed.pledges) ? seed.pledges : [],
          completions: seed.completions && typeof seed.completions === 'object' ? seed.completions : {},
          optedOutEmails: Array.isArray(seed.optedOutEmails) ? seed.optedOutEmails : [],
          assignmentRequests: Array.isArray(seed.assignmentRequests) ? seed.assignmentRequests : [],
        };
      }
    } catch (err) {
      console.warn(`Fruit audit tracker D${this.districtId}: could not load state, starting fresh:`, err.message);
    }
    return this.emptyState();
  }

  persist() {
    if (!this.dataPath) return;
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.dataPath, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (err) {
      console.error(`Fruit audit tracker D${this.districtId}: failed to persist state:`, err.message);
    }
  }

  init() {
    const needsInitialPersist = this.dataPath && !fs.existsSync(this.dataPath);
    this.state = this.loadState();
    if (!this.state.deadline || PREVIOUS_DEFAULT_DEADLINE_ISOS.has(this.state.deadline)) {
      this.state.deadline = this.defaultDeadline();
      this.persist();
    }
    this.syncDerivedCompletions({ persistChanges: true });
    this.pruneRemovedStoreState({ persistChanges: true });
    this.syncDefaultAssignments({ persistChanges: true });
    if (needsInitialPersist) this.persist();
    return this.state;
  }

  getManifestStore(storeId) {
    return (fruitAuditManifest.stores || []).find(store => store.id === storeId && String(store.district) === this.districtId);
  }

  destinationSetStatus(storeDir, set) {
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

  destinationCompletionForStore(meta) {
    if (!this.completionRoot) return null;
    const storeDir = findChildDirectory(this.completionRoot, meta.id);
    if (!storeDir) return null;
    const manifestStore = this.getManifestStore(meta.id);
    const sets = manifestStore && Array.isArray(manifestStore.sets) ? manifestStore.sets : [];
    if (!sets.length) return null;
    const statuses = sets.map(set => this.destinationSetStatus(storeDir, set));
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

  seededCompletionForStore(storeId) {
    const meta = this.getStoreMeta(storeId);
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

  syncDerivedCompletions({ persistChanges = false } = {}) {
    if (!this.state) return false;
    let changed = false;
    const derived = [
      ...Array.from(this.seededCompleteStores).map(storeId => this.seededCompletionForStore(storeId)),
      ...this.stores.map(meta => this.destinationCompletionForStore(meta)).filter(Boolean),
    ];
    for (const entry of derived) {
      if (!entry || !entry.storeId || this.state.completions[entry.storeId]) continue;
      this.state.completions[entry.storeId] = entry;
      changed = true;
    }
    if (changed) {
      this.state.updatedAt = new Date().toISOString();
      if (persistChanges) this.persist();
    }
    return changed;
  }

  assignmentScheduleFields(assignment) {
    const scheduledDates = Array.isArray(assignment && assignment.scheduledDates)
      ? assignment.scheduledDates.filter(Boolean).sort()
      : [];
    return {
      scheduledDates,
      scheduledLabel: assignment && assignment.scheduledLabel
        ? assignment.scheduledLabel
        : scheduledLabelForDates(scheduledDates),
    };
  }

  seededPledgeForAssignment(assignment) {
    const storeId = this.padStoreId(assignment.storeId);
    const email = String(assignment.email || '').trim();
    const name = String(assignment.name || '').trim();
    if (!storeId || !email || !name) return null;
    const schedule = this.assignmentScheduleFields(assignment);
    return {
      id: assignmentId(storeId, email),
      storeId,
      name,
      email,
      pledgedAt: DEFAULT_ASSIGNMENT_PLEDGED_AT,
      source: assignment.source || 'scheduled-assignment',
      ...schedule,
    };
  }

  applyAssignmentSchedule(pledge, assignment) {
    const schedule = this.assignmentScheduleFields(assignment);
    let changed = false;
    if (JSON.stringify(pledge.scheduledDates || []) !== JSON.stringify(schedule.scheduledDates)) {
      pledge.scheduledDates = schedule.scheduledDates;
      changed = true;
    }
    if ((pledge.scheduledLabel || '') !== (schedule.scheduledLabel || '')) {
      pledge.scheduledLabel = schedule.scheduledLabel;
      changed = true;
    }
    if ((pledge.source || '') !== (assignment.source || '')) {
      pledge.source = assignment.source || pledge.source;
      changed = true;
    }
    return changed;
  }

  pruneRemovedStoreState({ persistChanges = false } = {}) {
    if (!this.state) return false;
    let changed = false;
    const beforePledges = this.state.pledges.length;
    this.state.pledges = this.state.pledges.filter(pledge => this.storeIds.has(pledge.storeId));
    if (this.state.pledges.length !== beforePledges) changed = true;
    for (const storeId of Object.keys(this.state.completions || {})) {
      if (!this.storeIds.has(storeId)) {
        delete this.state.completions[storeId];
        changed = true;
      }
    }
    if (changed) {
      this.state.updatedAt = new Date().toISOString();
      if (persistChanges) this.persist();
    }
    return changed;
  }

  syncDefaultAssignments({ persistChanges = false } = {}) {
    if (!this.state) return false;
    let changed = false;
    const optedOutEmails = new Set((this.state.optedOutEmails || []).map(normalizeEmail));
    for (const assignment of this.defaultAssignments) {
      const pledge = this.seededPledgeForAssignment(assignment);
      if (!pledge || !pledge.storeId || this.isCompletionCompleteForPledge(pledge.storeId, pledge.email)) continue;
      const existing = this.state.pledges.find(item => (
        item.storeId === pledge.storeId && normalizeEmail(item.email) === normalizeEmail(pledge.email)
      ));
      if (existing) {
        changed = this.applyAssignmentSchedule(existing, assignment) || changed;
        continue;
      }
      const anyPledgeOnStore = this.state.pledges.some(item => item.storeId === pledge.storeId);
      if (anyPledgeOnStore) continue;
      if (!pledge.scheduledDates.length && optedOutEmails.has(normalizeEmail(pledge.email))) continue;
      this.state.pledges.push(pledge);
      changed = true;
    }
    if (changed) {
      this.state.updatedAt = new Date().toISOString();
      if (persistChanges) this.persist();
    }
    return changed;
  }

  broadcast() {
    const snapshot = this.buildSnapshot();
    this.bus.emit('update', snapshot);
    return snapshot;
  }

  pledgesForStore(storeId) {
    return this.state.pledges.filter(pledge => pledge.storeId === storeId);
  }

  getCompletionForPledge(storeId, email) {
    const keyed = this.state.completions[completionStorageKey(storeId, email)];
    if (keyed) return keyed;
    const legacy = this.state.completions[storeId];
    if (!legacy) return null;
    const normalized = normalizeEmail(email);
    if (legacy.email && normalizeEmail(legacy.email) === normalized) return legacy;
    const storePledges = this.pledgesForStore(storeId);
    if (storePledges.length === 1 && normalizeEmail(storePledges[0].email) === normalized) return legacy;
    return null;
  }

  isCompletionCompleteForPledge(storeId, email) {
    return Boolean(this.getCompletionForPledge(storeId, email));
  }

  isStoreFullyComplete(storeId) {
    const storePledges = this.pledgesForStore(storeId);
    if (!storePledges.length) return Boolean(this.state.completions[storeId]);
    return storePledges.every(pledge => this.isCompletionCompleteForPledge(storeId, pledge.email));
  }

  isStoreComplete(storeId) {
    return this.isStoreFullyComplete(storeId);
  }

  activePledgesForStore(storeId) {
    return this.state.pledges.filter(pledge => (
      pledge.storeId === storeId && !this.isCompletionCompleteForPledge(storeId, pledge.email)
    ));
  }

  isScheduledAssignment(pledge) {
    return Array.isArray(pledge && pledge.scheduledDates) && pledge.scheduledDates.length > 0;
  }

  addPledge({ name, email, storeId, force = false }) {
    const store = this.padStoreId(storeId);
    if (!store) throw new Error(`Invalid District ${this.districtId} fruit store number.`);
    const trimmedName = String(name || '').trim();
    const trimmedEmail = String(email || '').trim();
    if (trimmedName.length < 2) throw new Error('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      throw new Error('Please enter a valid email address.');
    }
    if (this.isStoreFullyComplete(store)) throw new Error(`FM ${store} is already complete.`);
    if (!force && this.activePledgesForStore(store).length) {
      throw new Error(`FM ${store} is already assigned. Pick another store or contact Tyson.`);
    }
    const pledge = {
      id: `fp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      storeId: store,
      name: trimmedName,
      email: trimmedEmail,
      pledgedAt: new Date().toISOString(),
    };
    this.state.optedOutEmails = (this.state.optedOutEmails || [])
      .filter(item => normalizeEmail(item) !== normalizeEmail(trimmedEmail));
    this.state.pledges.push(pledge);
    this.state.updatedAt = new Date().toISOString();
    this.persist();
    return { snapshot: this.broadcast(), pledge };
  }

  pendingAssignmentRequests() {
    return (this.state.assignmentRequests || []).filter(request => request.status === 'pending');
  }

  assignmentRequestById(requestId) {
    const id = String(requestId || '').trim();
    if (!id) return null;
    return (this.state.assignmentRequests || []).find(request => request.id === id) || null;
  }

  forceReleaseActivePledgesForStore(storeId) {
    const store = this.padStoreId(storeId);
    if (!store) throw new Error(`Invalid District ${this.districtId} fruit store number.`);
    if (this.isStoreFullyComplete(store)) {
      throw new Error(`FM ${store} is already complete and cannot be reassigned.`);
    }
    const released = [];
    this.state.pledges = this.state.pledges.filter(pledge => {
      if (pledge.storeId !== store) return true;
      if (this.isCompletionCompleteForPledge(store, pledge.email)) return true;
      released.push(pledge);
      return false;
    });
    if (released.length) {
      this.state.updatedAt = new Date().toISOString();
      this.persist();
    }
    return released;
  }

  addAssignmentRequest({ name, email, storeId, note }) {
    const store = this.padStoreId(storeId);
    if (!store) throw new Error(`Invalid District ${this.districtId} fruit store number.`);
    const trimmedName = String(name || '').trim();
    const trimmedEmail = String(email || '').trim();
    const trimmedNote = String(note || '').trim();
    if (trimmedName.length < 2) throw new Error('Please enter your full name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      throw new Error('Please enter a valid email address.');
    }
    if (this.isStoreFullyComplete(store)) throw new Error(`FM ${store} is already complete.`);
    if (this.isCompletionCompleteForPledge(store, trimmedEmail)) {
      throw new Error(`FM ${store} is already complete for your email.`);
    }
    const emailKey = normalizeEmail(trimmedEmail);
    const existingActive = this.activePledgesForStore(store)
      .find(pledge => normalizeEmail(pledge.email) === emailKey);
    if (existingActive) {
      throw new Error(`You are already assigned to FM ${store}. Open the fruit photo app to submit photos.`);
    }
    const pendingDuplicate = this.pendingAssignmentRequests().find(request => (
      request.storeId === store && normalizeEmail(request.email) === emailKey
    ));
    if (pendingDuplicate) {
      throw new Error(`You already have a pending assignment request for FM ${store}. Tyson will review it shortly.`);
    }

    const currentAssignees = this.activePledgesForStore(store).map(pledge => ({
      name: pledge.name,
      email: pledge.email,
      scheduledLabel: pledge.scheduledLabel || '',
    }));
    const request = {
      id: `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      storeId: store,
      name: trimmedName,
      email: trimmedEmail,
      note: trimmedNote,
      status: 'pending',
      requestedAt: new Date().toISOString(),
      currentAssignees,
    };
    this.state.assignmentRequests = [...(this.state.assignmentRequests || []), request];
    this.state.updatedAt = new Date().toISOString();
    this.persist();
    return { snapshot: this.broadcast(), request };
  }

  resolveAssignmentRequest({ requestId, action, resolverEmail, reason }) {
    const id = String(requestId || '').trim();
    const resolver = String(resolverEmail || '').trim();
    if (!id) throw new Error('Missing assignment request id.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resolver)) {
      throw new Error('Enter a valid supervisor email address.');
    }
    const request = this.assignmentRequestById(id);
    if (!request) throw new Error('Assignment request not found.');
    if (request.status !== 'pending') {
      throw new Error(`This assignment request was already ${request.status}.`);
    }

    const resolvedAt = new Date().toISOString();
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (normalizedAction === 'deny') {
      request.status = 'denied';
      request.resolvedAt = resolvedAt;
      request.resolvedBy = resolver;
      request.resolutionNote = String(reason || '').trim();
      this.state.updatedAt = resolvedAt;
      this.persist();
      return { snapshot: this.broadcast(), request, releasedPledges: [] };
    }
    if (normalizedAction !== 'approve') {
      throw new Error('Action must be approve or deny.');
    }

    const releasedPledges = this.forceReleaseActivePledgesForStore(request.storeId);
    const { pledge } = this.addPledge({
      name: request.name,
      email: request.email,
      storeId: request.storeId,
      force: true,
    });

    request.status = 'approved';
    request.resolvedAt = resolvedAt;
    request.resolvedBy = resolver;
    request.pledgeId = pledge.id;

    (this.state.assignmentRequests || []).forEach(other => {
      if (other.id === request.id || other.status !== 'pending' || other.storeId !== request.storeId) return;
      other.status = 'denied';
      other.resolvedAt = resolvedAt;
      other.resolvedBy = resolver;
      other.resolutionNote = `FM ${request.storeId} was assigned to ${request.name}.`;
    });

    this.state.updatedAt = resolvedAt;
    this.persist();
    return {
      snapshot: this.broadcast(),
      request,
      pledge,
      releasedPledges,
    };
  }

  removePledge({ pledgeId, email }) {
    const id = String(pledgeId || '').trim();
    if (!id) throw new Error('Missing assignment id.');
    const trimmedEmail = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      throw new Error('Enter the same email you used when you were assigned the store.');
    }
    const idx = this.state.pledges.findIndex(pledge => pledge.id === id);
    if (idx === -1) throw new Error('Assignment not found. It may have already been released.');
    const pledge = this.state.pledges[idx];
    if (normalizeEmail(pledge.email) !== normalizeEmail(trimmedEmail)) {
      throw new Error('You can only release a store assigned to this email address.');
    }
    if (this.isScheduledAssignment(pledge)) {
      throw new Error(`Scheduled District ${this.districtId} audit assignments cannot be released from the dashboard. Contact Tyson if the schedule needs to change.`);
    }
    if (this.isCompletionCompleteForPledge(pledge.storeId, pledge.email)) {
      throw new Error(`FM ${pledge.storeId} is already complete and cannot be released.`);
    }
    this.state.pledges.splice(idx, 1);
    this.state.updatedAt = new Date().toISOString();
    this.persist();
    return { snapshot: this.broadcast(), pledge };
  }

  removePledgeAsSupervisor({ pledgeId, email }) {
    const id = String(pledgeId || '').trim();
    if (!id) throw new Error('Missing assignment id.');
    const trimmedEmail = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      throw new Error('Enter a valid supervisor email address.');
    }
    const idx = this.state.pledges.findIndex(pledge => pledge.id === id);
    if (idx === -1) throw new Error('Assignment not found. It may have already been released.');
    const pledge = this.state.pledges[idx];
    if (this.isCompletionCompleteForPledge(pledge.storeId, pledge.email)) {
      throw new Error(`FM ${pledge.storeId} is already complete and cannot be released.`);
    }
    this.state.pledges.splice(idx, 1);
    this.state.updatedAt = new Date().toISOString();
    this.persist();
    return { snapshot: this.broadcast(), pledge };
  }

  removePledgesForEmail({ email }) {
    const trimmedEmail = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      throw new Error('Enter the same email you used when you were assigned the store.');
    }
    const emailKey = normalizeEmail(trimmedEmail);
    const releasedPledges = [];
    this.state.pledges = this.state.pledges.filter(pledge => {
      const shouldRelease = normalizeEmail(pledge.email) === emailKey
        && !this.isScheduledAssignment(pledge)
        && !this.isCompletionCompleteForPledge(pledge.storeId, pledge.email);
      if (shouldRelease) releasedPledges.push(pledge);
      return !shouldRelease;
    });
    if (!releasedPledges.length) {
      const hasScheduledAssignment = this.state.pledges.some(pledge => (
        normalizeEmail(pledge.email) === emailKey
        && this.isScheduledAssignment(pledge)
        && !this.isCompletionCompleteForPledge(pledge.storeId, pledge.email)
      ));
      if (hasScheduledAssignment) {
        throw new Error(`Scheduled District ${this.districtId} audit assignments cannot be released from the dashboard. Contact Tyson if the schedule needs to change.`);
      }
      throw new Error(`No active District ${this.districtId} fruit audit assignments found for this email.`);
    }
    if (!(this.state.optedOutEmails || []).some(item => normalizeEmail(item) === emailKey)) {
      this.state.optedOutEmails = [...(this.state.optedOutEmails || []), trimmedEmail];
    }
    this.state.updatedAt = new Date().toISOString();
    this.persist();
    return { snapshot: this.broadcast(), pledges: releasedPledges };
  }

  getStoreMeta(storeId) {
    return this.stores.find(store => store.id === storeId) || { id: storeId, label: `FM ${storeId}`, district: this.districtId };
  }

  recordCompletion({ storeId, name, email, photoCount, setCount }) {
    const store = this.padStoreId(storeId);
    if (!store) return null;
    const trimmedEmail = String(email || '').trim();
    const entry = {
      storeId: store,
      name: String(name || '').trim() || 'Unknown',
      email: trimmedEmail,
      photoCount: Number(photoCount) || 0,
      setCount: Number(setCount) || 0,
      completedAt: new Date().toISOString(),
    };
    const storageKey = completionStorageKey(store, trimmedEmail) || store;
    this.state.completions[storageKey] = entry;
    const legacy = this.state.completions[store];
    if (legacy && legacy !== entry && normalizeEmail(legacy.email) === normalizeEmail(trimmedEmail)) {
      delete this.state.completions[store];
    }
    this.state.updatedAt = new Date().toISOString();
    this.persist();
    return this.broadcast();
  }

  buildSnapshot() {
    this.syncDerivedCompletions({ persistChanges: true });
    this.pruneRemovedStoreState({ persistChanges: true });
    this.syncDefaultAssignments({ persistChanges: true });
    const now = Date.now();
    const deadlineMs = Date.parse(this.state.deadline);
    const stores = this.stores.map(meta => {
      const storePledges = this.pledgesForStore(meta.id);
      const pledges = this.activePledgesForStore(meta.id);
      const completionRecords = storePledges
        .map(pledge => this.getCompletionForPledge(meta.id, pledge.email))
        .filter(Boolean);
      const legacyCompletion = this.state.completions[meta.id] || null;
      const assignmentList = this.defaultAssignmentsByStore[meta.id] || [];
      const firstAssignment = assignmentList[0] || null;
      let status = 'open';
      if (!storePledges.length) {
        status = legacyCompletion ? 'complete' : 'open';
      } else if (!pledges.length) {
        status = 'complete';
      } else if (pledges.length) {
        status = 'pledged';
      }
      const completion = status === 'complete'
        ? (completionRecords[0] || legacyCompletion)
        : null;
      return {
        ...meta,
        scheduledDates: pledges.length
          ? [...new Set(pledges.flatMap(pledge => pledge.scheduledDates || []))].sort()
          : this.assignmentScheduleFields(firstAssignment || {}).scheduledDates,
        scheduledLabel: pledges.length
          ? [...new Set(pledges.map(pledge => pledge.scheduledLabel).filter(Boolean))].join(', ')
          : this.assignmentScheduleFields(firstAssignment || {}).scheduledLabel,
        status,
        pledge: pledges[0] || null,
        pledges,
        completion,
        completionRecords,
      };
    });
    const completeCount = stores.filter(store => store.status === 'complete').length;
    const pledgedCount = stores.filter(store => store.status === 'pledged').length;
    const openCount = stores.filter(store => store.status === 'open').length;
    const completedByEmail = {};
    Object.values(this.state.completions || {}).forEach(completion => {
      if (!completion || !completion.storeId) return;
      const email = String(completion.email || '').trim();
      const key = email.toLowerCase() || `system:${completion.storeId}`;
      if (!completedByEmail[key]) {
        completedByEmail[key] = {
          name: completion.name || 'Unknown',
          email,
          completed: 0,
          stores: [],
        };
      }
      if (!completedByEmail[key].stores.includes(completion.storeId)) {
        completedByEmail[key].completed += 1;
        completedByEmail[key].stores.push(completion.storeId);
      }
    });
    const completedBy = Object.values(completedByEmail)
      .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
    return {
      project: `District ${this.districtId} Fruit Audit`,
      district: this.districtId,
      deadline: this.state.deadline,
      deadlineMs: Number.isFinite(deadlineMs) ? deadlineMs : null,
      nowMs: now,
      stores,
      pledges: [...this.state.pledges].sort((a, b) => a.storeId.localeCompare(b.storeId) || a.name.localeCompare(b.name)),
      completions: this.state.completions,
      optedOutEmails: [...(this.state.optedOutEmails || [])],
      assignmentRequests: [...(this.state.assignmentRequests || [])]
        .sort((a, b) => String(b.requestedAt || '').localeCompare(String(a.requestedAt || ''))),
      pendingAssignmentRequestCount: this.pendingAssignmentRequests().length,
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
      updatedAt: this.state.updatedAt,
    };
  }

  getSnapshot() {
    return this.buildSnapshot();
  }

  subscribe(res) {
    const snapshot = this.buildSnapshot();
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    const onUpdate = data => {
      res.write(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`);
    };
    this.bus.on('update', onUpdate);
    res.on('close', () => this.bus.off('update', onUpdate));
  }
}

const trackers = new Map();

function statePathForDistrict(baseDataPath, districtId) {
  if (districtId === '1') return baseDataPath;
  const parsed = path.parse(baseDataPath);
  return path.join(parsed.dir, `${parsed.name}-d${districtId}${parsed.ext}`);
}

function init({ baseDataPath, completionRootForDistrict } = {}) {
  TRACKED_DISTRICTS.forEach(districtId => {
    const tracker = new DistrictFruitAuditTracker(districtId, {
      dataPath: statePathForDistrict(baseDataPath || path.join(process.cwd(), 'data', 'fruit-audit-tracker-state.json'), districtId),
      completionRoot: completionRootForDistrict ? completionRootForDistrict(districtId) : DEFAULT_COMPLETION_ROOTS[districtId],
    });
    tracker.init();
    trackers.set(districtId, tracker);
  });
}

function getTracker(districtId = '1') {
  const id = String(districtId || '1');
  const tracker = trackers.get(id);
  if (!tracker) throw new Error(`District ${id} does not have a fruit audit tracker.`);
  return tracker;
}

function isTrackedDistrict(districtId) {
  return TRACKED_DISTRICTS.has(String(districtId || ''));
}

module.exports = {
  TRACKED_DISTRICTS,
  DistrictFruitAuditTracker,
  init,
  getTracker,
  isTrackedDistrict,
  trackedDistrictIds,
  assignmentsForDistrict,
  completionStorageKey,
  allAssignmentEmails,
  normalizeEmail,
};
