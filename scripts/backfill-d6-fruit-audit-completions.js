#!/usr/bin/env node
/**
 * Backfill District 6 fruit audit tracker completions for stores whose photos
 * are already saved locally but not reflected on the hosted tracker.
 */

const fs = require('fs');
const path = require('path');

const fruitAuditDistrictTrackers = require('../lib/fruit-audit-district-trackers');

const DISTRICT = '6';
const COMPLETE_STORES = ['049', '163', '214', '286', '486', '657'];
const COMPLETION_ROOT = String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D6`;

function parseArgs(argv) {
  const args = { statePath: null, dryRun: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--state-path') {
      args.statePath = argv[i + 1] || null;
      i += 1;
    }
  }
  return args;
}

function defaultStatePath() {
  if (process.env.FRUIT_AUDIT_TRACKER_DATA_PATH) {
    const parsed = path.parse(process.env.FRUIT_AUDIT_TRACKER_DATA_PATH);
    return path.join(parsed.dir, `${parsed.name}-d6${parsed.ext}`);
  }
  if (fs.existsSync('/data')) {
    return '/data/fruit-audit-tracker-state-d6.json';
  }
  return path.join(__dirname, '..', 'data', 'fruit-audit-tracker-state-d6.json');
}

function completionEntryForStore(tracker, storeId) {
  const meta = tracker.getStoreMeta(storeId);
  const derived = tracker.destinationCompletionForStore(meta);
  if (derived) return derived;
  return {
    storeId,
    name: 'Marked complete',
    email: '',
    photoCount: Number(meta.photoTargetCount) || Number(meta.setCount || 0) * 4,
    setCount: Number(meta.setCount) || 0,
    completedAt: new Date().toISOString(),
    source: 'manual-seed',
  };
}

function ensureStoreCompletion(tracker, storeId, entry) {
  let changed = false;
  const storePledges = tracker.pledgesForStore(storeId);
  if (!storePledges.length) {
    if (!tracker.state.completions[storeId]) {
      tracker.state.completions[storeId] = entry;
      changed = true;
    }
    return changed;
  }

  if (!tracker.state.completions[storeId]) {
    tracker.state.completions[storeId] = entry;
    changed = true;
  }

  for (const pledge of storePledges) {
    const key = fruitAuditDistrictTrackers.completionStorageKey(storeId, pledge.email);
    if (!key || tracker.state.completions[key]) continue;
    tracker.state.completions[key] = {
      ...entry,
      email: pledge.email,
      name: pledge.name || entry.name,
    };
    changed = true;
  }
  return changed;
}

function main() {
  const args = parseArgs(process.argv);
  const statePath = args.statePath || defaultStatePath();
  const baseDataPath = path.join(path.dirname(statePath), 'fruit-audit-tracker-state.json');

  fruitAuditDistrictTrackers.init({
    baseDataPath,
    completionRootForDistrict: districtId => (
      districtId === DISTRICT && fs.existsSync(COMPLETION_ROOT) ? COMPLETION_ROOT : null
    ),
  });

  const tracker = fruitAuditDistrictTrackers.getTracker(DISTRICT);

  const before = tracker.getSnapshot();
  let changed = false;
  for (const storeId of COMPLETE_STORES) {
    if (!tracker.padStoreId(storeId)) {
      console.warn(`Skipping unknown D6 store ${storeId}`);
      continue;
    }
    if (tracker.isStoreFullyComplete(storeId)) {
      console.log(`FM ${storeId}: already complete`);
      continue;
    }
    const entry = completionEntryForStore(tracker, storeId);
    if (ensureStoreCompletion(tracker, storeId, entry)) {
      changed = true;
      console.log(`FM ${storeId}: marked complete (${entry.source})`);
    }
  }

  if (!changed) {
    console.log('No D6 tracker changes needed.');
    return;
  }

  tracker.state.updatedAt = new Date().toISOString();
  if (args.dryRun) {
    console.log('Dry run only; state not persisted.');
    return;
  }

  tracker.persist();
  const after = tracker.getSnapshot();
  console.log('\nDistrict 6 fruit audit tracker backfill complete');
  console.log(`State file: ${statePath}`);
  console.log(`Before: ${before.stats.complete}/${before.stats.total} complete`);
  console.log(`After:  ${after.stats.complete}/${after.stats.total} complete`);
  console.log('Remaining stores:');
  after.stores
    .filter(store => store.status !== 'complete')
    .forEach(store => console.log(`  FM ${store.id} (${store.status})`));
}

main();
