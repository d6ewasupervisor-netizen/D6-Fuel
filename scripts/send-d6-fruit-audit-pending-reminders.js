#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Resend } = require('resend');
const fruitAuditTrackerNotify = require('../lib/fruit-audit-tracker-notify');
const { completionStorageKey, normalizeEmail } = require('../lib/fruit-audit-district-trackers');

const DASHBOARD_URL = process.env.D6_FRUIT_AUDIT_DASHBOARD_URL
  || 'https://fuel.retail-odyssey.com/fruit-audit-dashboard?district=6';
const FIELD_APP_URL = 'https://fuel.retail-odyssey.com/fruit-audit?district=6';
const CC = [
  'tyson.gauthier@retailodyssey.com',
  'd6ewa.supervisor@gmail.com',
  'april.gauthier@retailodyssey.com',
];

const REMINDERS = [
  {
    name: 'Saviya Hurley Joanne',
    email: 'saviya.hurley@retailodyssey.com',
    storeId: '351',
    scheduledLabel: 'Fri, 6/19',
  },
  {
    name: 'Cindy Roth L',
    email: 'cindy.roth@sasretailservices.com',
    storeId: '654',
    scheduledLabel: 'Mon, 6/15, Tue, 6/16, Wed, 6/17, Thu, 6/18',
  },
];

function trackerDataPath() {
  const railwayDataDir = '/data';
  return process.env.FRUIT_AUDIT_TRACKER_DATA_PATH
    || (fs.existsSync(railwayDataDir)
      ? path.join(railwayDataDir, 'fruit-audit-tracker-state.json')
      : path.join(__dirname, '..', 'data', 'fruit-audit-tracker-state.json'));
}

function loadD6State() {
  const base = trackerDataPath();
  const parsed = path.parse(base);
  const statePath = path.join(parsed.dir, `${parsed.name}-d6${parsed.ext}`);
  if (!fs.existsSync(statePath)) return { pledges: [], completions: {} };
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function isCompletionCompleteForPledge(state, storeId, email) {
  const keyed = state.completions[completionStorageKey(storeId, email)];
  if (keyed) return true;
  const legacy = state.completions[storeId];
  if (!legacy) return false;
  if (!legacy.email) return true;
  return normalizeEmail(legacy.email) === normalizeEmail(email);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SIGNOFF_API_KEY;
  if (!resendApiKey && !dryRun) {
    throw new Error('RESEND_API_KEY is not set');
  }
  const resend = resendApiKey ? new Resend(resendApiKey) : null;
  const state = loadD6State();

  for (const recipient of REMINDERS) {
    const pledge = (state.pledges || []).find(item => (
      item.storeId === recipient.storeId
      && normalizeEmail(item.email) === normalizeEmail(recipient.email)
    ));
    if (pledge && isCompletionCompleteForPledge(state, recipient.storeId, recipient.email)) {
      console.log(`Skipping FM ${recipient.storeId} for ${recipient.email}; store already complete.`);
      continue;
    }

    const assignments = [{
      storeId: recipient.storeId,
      scheduledLabel: recipient.scheduledLabel || (pledge && pledge.scheduledLabel) || '',
    }];

    if (dryRun) {
      console.log(`DRY RUN: reminder -> ${recipient.name} <${recipient.email}> FM ${recipient.storeId}`);
      continue;
    }

    const result = await fruitAuditTrackerNotify.sendD6FruitAuditInvite(resend, {
      name: recipient.name,
      email: recipient.email,
      dashboardUrl: DASHBOARD_URL,
      fieldAppUrl: FIELD_APP_URL,
      cc: CC,
      alreadyAssigned: true,
      assignments,
    });
    if (!result.ok) {
      console.error(`Failed for ${recipient.email}:`, result.error || result.skipped || 'unknown');
      process.exitCode = 1;
      continue;
    }
    console.log(`Sent reminder to ${recipient.email} for FM ${recipient.storeId} (id: ${result.id || 'n/a'})`);
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
