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
const STATE_PATH = path.join(__dirname, '..', 'data', 'fruit-audit-tracker-state-d6.json');

const RECIPIENTS = [
  { name: 'Jennifer Hilderbrand Lynn', email: 'jennifer.hilderbrand@retailodyssey.com' },
  { name: 'Patricia Magana', email: 'patricia.magana@retailodyssey.com' },
  { name: 'Cindy Roth L', email: 'cindy.roth@sasretailservices.com' },
  { name: 'Saviya Hurley Joanne', email: 'saviya.hurley@retailodyssey.com' },
  { name: 'Samantha Capps Halee', email: 'samantha.capps@youradv.com' },
  { name: 'Tiffany Pond Marie', email: 'tiffanypond04@gmail.com' },
  { name: 'Tina Loera Marie', email: 'tinaloera1970@gmail.com' },
  { name: 'Jacqueline Pond Michele', email: 'jaxpond8@gmail.com' },
  { name: 'Julian Russum Jack', email: 'russumj@cwu.edu' },
];

function loadTrackerState() {
  if (!fs.existsSync(STATE_PATH)) return { pledges: [], completions: {} };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function isCompletionCompleteForPledge(state, storeId, email) {
  const keyed = state.completions[completionStorageKey(storeId, email)];
  if (keyed) return true;
  const legacy = state.completions[storeId];
  if (!legacy) return false;
  if (!legacy.email) return true;
  return normalizeEmail(legacy.email) === normalizeEmail(email);
}

function activeAssignmentsForEmail(state, email) {
  const emailKey = normalizeEmail(email);
  return (state.pledges || [])
    .filter(pledge => normalizeEmail(pledge.email) === emailKey)
    .filter(pledge => !isCompletionCompleteForPledge(state, pledge.storeId, pledge.email))
    .map(pledge => ({
      storeId: pledge.storeId,
      scheduledLabel: pledge.scheduledLabel || '',
    }))
    .sort((a, b) => a.storeId.localeCompare(b.storeId));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SIGNOFF_API_KEY;
  if (!resendApiKey && !dryRun) {
    throw new Error('RESEND_API_KEY is not set');
  }
  const resend = resendApiKey ? new Resend(resendApiKey) : null;
  const state = loadTrackerState();

  for (const recipient of RECIPIENTS) {
    const assignments = activeAssignmentsForEmail(state, recipient.email);
    const alreadyAssigned = assignments.length > 0;
    if (dryRun) {
      console.log(`DRY RUN: ${alreadyAssigned ? 'REMINDER' : 'NEW'} -> ${recipient.name} <${recipient.email}>${alreadyAssigned ? ` (FM ${assignments.map(a => a.storeId).join(', FM ')})` : ''}`);
      continue;
    }
    const result = await fruitAuditTrackerNotify.sendD6FruitAuditInvite(resend, {
      name: recipient.name,
      email: recipient.email,
      dashboardUrl: DASHBOARD_URL,
      fieldAppUrl: FIELD_APP_URL,
      cc: CC,
      alreadyAssigned,
      assignments,
    });
    if (!result.ok) {
      console.error(`Failed for ${recipient.email}:`, result.error || result.skipped || 'unknown');
    } else {
      console.log(`Sent ${alreadyAssigned ? 'reminder' : 'invite'} to ${recipient.email} (id: ${result.id || 'n/a'})`);
    }
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
