#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { init, getTracker } = require('../lib/fruit-audit-district-trackers');
const fruitAuditTrackerNotify = require('../lib/fruit-audit-tracker-notify');

const DISTRICT = '6';
const CC = ['tyson.gauthier@retailodyssey.com', 'd6ewa.supervisor@gmail.com'];
const DASHBOARD_URL = 'https://fuel.retail-odyssey.com/fruit-audit-dashboard?district=6';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, storeId: null, name: null, email: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--store' && args[i + 1]) { out.storeId = args[++i]; }
    else if (arg === '--name' && args[i + 1]) { out.name = args[++i]; }
    else if (arg === '--email' && args[i + 1]) { out.email = args[++i]; }
  }
  return out;
}

function trackerDataPath() {
  const railwayDataDir = '/data';
  return process.env.FRUIT_AUDIT_TRACKER_DATA_PATH
    || (fs.existsSync(railwayDataDir)
      ? path.join(railwayDataDir, 'fruit-audit-tracker-state.json')
      : path.join(__dirname, '..', 'data', 'fruit-audit-tracker-state.json'));
}

async function main() {
  const { dryRun, storeId, name, email } = parseArgs();
  if (!storeId || !name || !email) {
    throw new Error('Usage: node scripts/assign-d6-fruit-audit.js --store 657 --name "Tina Loera Marie" --email tinaloera1970@gmail.com');
  }

  init({ baseDataPath: trackerDataPath() });
  const tracker = getTracker(DISTRICT);

  if (dryRun) {
    console.log(`DRY RUN: would assign FM ${storeId} to ${name} <${email}> and email with CC ${CC.join(', ')}`);
    return;
  }

  const released = tracker.forceReleaseActivePledgesForStore(storeId);
  if (released.length) {
    console.log(`Released ${released.length} prior assignment(s) on FM ${storeId}: ${released.map(p => p.name).join(', ')}`);
  }

  const store = tracker.padStoreId(storeId);
  if (store && tracker.state.completions[store]) {
    delete tracker.state.completions[store];
    Object.keys(tracker.state.completions).forEach(key => {
      if (key.startsWith(`${store}::`)) delete tracker.state.completions[key];
    });
    tracker.state.updatedAt = new Date().toISOString();
    tracker.persist();
    console.log(`Cleared prior completion record for FM ${store} so the store can be reassigned.`);
  }

  const { snapshot, pledge } = tracker.addPledge({
    name,
    email,
    storeId,
    force: true,
  });
  const meta = tracker.getStoreMeta(pledge.storeId);
  console.log(`Assigned FM ${pledge.storeId} to ${pledge.name} <${pledge.email}>`);

  const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SIGNOFF_API_KEY;
  if (!resendApiKey) throw new Error('RESEND_API_KEY is not set');
  const resend = new Resend(resendApiKey);

  const result = await fruitAuditTrackerNotify.sendAssigneeAssignmentNotice(resend, {
    pledge,
    meta,
    deadline: snapshot.deadline,
    dashboardUrl: DASHBOARD_URL,
    fieldAppUrl: `https://fuel.retail-odyssey.com/fruit-audit?district=6&store=${pledge.storeId}`,
    assignedBy: { name: 'Tyson Gauthier', email: 'tyson.gauthier@retailodyssey.com' },
    cc: CC,
  });

  if (!result.ok) {
    console.error('Assignment saved but email failed:', result.error || result.skipped || 'unknown');
    process.exit(1);
  }
  console.log(`Confirmation email sent to ${pledge.email} (id: ${result.id || 'n/a'}), CC: ${CC.join(', ')}`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
