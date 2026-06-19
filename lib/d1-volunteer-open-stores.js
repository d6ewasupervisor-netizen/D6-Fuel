'use strict';

const fruitAuditManifest = require('../data/fruit-audit-manifest.json');

const PHOTO_STORES = new Set(['035', '040', '060', '143', '153', '220', '240', '482', '661', '694']);

function d1StoreIds() {
  const district = (fruitAuditManifest.districts || []).find(d => String(d.id) === '1');
  return district && Array.isArray(district.storeIds) ? district.storeIds : [];
}

function targetStoreIdsFromSnapshot(snapshot) {
  const complete = new Set(
    (snapshot.stores || [])
      .filter(store => store.status === 'complete')
      .map(store => store.id),
  );
  return d1StoreIds().filter(storeId => !PHOTO_STORES.has(storeId) && !complete.has(storeId));
}

function targetStoreIdsFromTracker(tracker) {
  return targetStoreIdsFromSnapshot(tracker.buildSnapshot());
}

function openRemainingVolunteerStores(tracker) {
  const targetStores = targetStoreIdsFromTracker(tracker);
  if (!targetStores.length) {
    return {
      targetStores: [],
      released: [],
      opened: [],
      skipped: [],
      snapshot: tracker.buildSnapshot(),
    };
  }
  return {
    targetStores,
    ...tracker.openStoresForVolunteerSignup(targetStores),
  };
}

module.exports = {
  PHOTO_STORES,
  d1StoreIds,
  targetStoreIdsFromSnapshot,
  targetStoreIdsFromTracker,
  openRemainingVolunteerStores,
};
