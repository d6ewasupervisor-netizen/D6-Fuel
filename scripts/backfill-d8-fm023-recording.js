#!/usr/bin/env node
/**
 * Backfill District 8 FM 023 assignment for Aiyana and write versioned
 * folder records for photos already saved under the D8 fruit audit root.
 */

const fs = require('fs');
const path = require('path');

const fruitAuditDistrictTrackers = require('../lib/fruit-audit-district-trackers');
const { writeFileVersioned } = require('../lib/file-utils');
const manifest = require('../data/fruit-audit-manifest.json');

const STORE_ID = '023';
const DISTRICT = '8';
const ASSIGNEE = {
  name: 'Aiyana Natarisalazar',
  email: 'aiyana.natarisalazar@retailodyssey.com',
};
const COMPLETION_ROOT = String.raw`C:\Users\tgaut\OneDrive - Advantage Solutions\Auston Nix's files - Trackers\P5W3 Audit C600, C602, C604, C517\Fruit Photos\D8`;

function logInfo(message, extra) {
  if (extra) console.log(message, extra);
  else console.log(message);
}

function sideFromFilename(name) {
  const base = path.basename(name, path.extname(name));
  const match = base.match(/^(Front|Right_Side|Back|Left_Side)_\d+$/i);
  return match ? match[1] : base;
}

function listSetFolders(storeDir) {
  if (!fs.existsSync(storeDir)) return [];
  return fs.readdirSync(storeDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      dir: path.join(storeDir, entry.name),
    }));
}

function listPhotos(setDir) {
  return fs.readdirSync(setDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.jpe?g$/i.test(entry.name))
    .map(entry => {
      const filePath = path.join(setDir, entry.name);
      const stat = fs.statSync(filePath);
      return {
        fileName: entry.name,
        side: sideFromFilename(entry.name),
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
}

async function writeVersionedJson(targetDir, baseName, payload) {
  const desiredPath = path.join(targetDir, `${baseName}.json`);
  const writtenPath = await writeFileVersioned(desiredPath, `${JSON.stringify(payload, null, 2)}\n`, {
    info: meta => logInfo(`  wrote ${meta.versioned || meta.original}`),
  });
  return writtenPath;
}

async function main() {
  const statePath = path.join(__dirname, '..', 'data', 'fruit-audit-tracker-state.json');
  fruitAuditDistrictTrackers.init({
    baseDataPath: statePath,
    completionRootForDistrict: districtId => (
      districtId === DISTRICT ? COMPLETION_ROOT : null
    ),
  });

  const tracker = fruitAuditDistrictTrackers.getTracker(DISTRICT);
  const snapshotBefore = tracker.getSnapshot();
  const storeBefore = (snapshotBefore.stores || []).find(store => store.id === STORE_ID);

  let changed = false;
  const pledgeExists = (tracker.state.pledges || []).some(pledge => (
    pledge.storeId === STORE_ID
    && fruitAuditDistrictTrackers.normalizeEmail(pledge.email) === fruitAuditDistrictTrackers.normalizeEmail(ASSIGNEE.email)
  ));
  if (!pledgeExists) {
    tracker.state.pledges.push({
      id: `seeded_${STORE_ID}_aiyana_natarisalazar_retailodyssey_com`,
      storeId: STORE_ID,
      name: ASSIGNEE.name,
      email: ASSIGNEE.email,
      pledgedAt: new Date().toISOString(),
      scheduledDates: [],
      scheduledLabel: '',
      source: 'manual-backfill',
    });
    changed = true;
  }

  const legacyCompletion = tracker.state.completions[STORE_ID];
  if (legacyCompletion && !legacyCompletion.email) {
    delete tracker.state.completions[STORE_ID];
    changed = true;
  }

  const keyed = tracker.state.completions[fruitAuditDistrictTrackers.completionStorageKey(STORE_ID, ASSIGNEE.email)];
  if (keyed && keyed.source === 'destination-folder' && !keyed.email) {
    delete tracker.state.completions[fruitAuditDistrictTrackers.completionStorageKey(STORE_ID, ASSIGNEE.email)];
    changed = true;
  }

  if (changed) {
    tracker.state.updatedAt = new Date().toISOString();
    tracker.persist();
  }

  const storeDir = path.join(COMPLETION_ROOT, STORE_ID);
  const manifestStore = (manifest.stores || []).find(store => store.id === STORE_ID && String(store.district) === DISTRICT);
  const setFolders = listSetFolders(storeDir);
  const folderRecords = [];

  const assignmentRecord = {
    generatedAt: new Date().toISOString(),
    district: DISTRICT,
    storeId: STORE_ID,
    storeName: manifestStore && manifestStore.address ? manifestStore.address.name : 'Fred Meyer',
    assignee: ASSIGNEE,
    source: 'manual-backfill',
    note: 'Backfilled because FM 023 D8 assignment was not recorded at submit time.',
  };
  const assignmentPath = await writeVersionedJson(storeDir, 'Assignment Record', assignmentRecord);
  folderRecords.push(assignmentPath);

  for (const setFolder of setFolders) {
    const photos = listPhotos(setFolder.dir);
    if (!photos.length) continue;
    const captureRecord = {
      generatedAt: new Date().toISOString(),
      district: DISTRICT,
      storeId: STORE_ID,
      setFolder: setFolder.name,
      assignee: ASSIGNEE,
      photoCount: photos.length,
      photos,
      source: 'manual-backfill',
    };
    const capturePath = await writeVersionedJson(setFolder.dir, 'Capture Record', captureRecord);
    folderRecords.push(capturePath);
  }

  const snapshotAfter = tracker.getSnapshot();
  const storeAfter = (snapshotAfter.stores || []).find(store => store.id === STORE_ID);

  console.log('\nFM 023 D8 backfill complete');
  console.log(`Tracker state: ${statePath}`);
  console.log(`Before: status=${storeBefore && storeBefore.status}, assignee=${storeBefore && storeBefore.pledge ? storeBefore.pledge.email : 'none'}`);
  console.log(`After:  status=${storeAfter && storeAfter.status}, assignee=${storeAfter && storeAfter.pledge ? storeAfter.pledge.email : 'none'}`);
  console.log('Folder records:');
  folderRecords.forEach(recordPath => console.log(`  ${recordPath}`));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
