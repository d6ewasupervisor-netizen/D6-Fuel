#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Resend } = require('resend');
const fruitAuditTrackerNotify = require('../lib/fruit-audit-tracker-notify');

const DASHBOARD_URL = process.env.D6_FRUIT_AUDIT_DASHBOARD_URL
  || 'https://fuel.retail-odyssey.com/fruit-audit-dashboard?district=6';
const FIELD_APP_URL = 'https://fuel.retail-odyssey.com/fruit-audit?district=6';
const CC = [
  'tyson.gauthier@retailodyssey.com',
  'd6ewa.supervisor@gmail.com',
  'april.gauthier@retailodyssey.com',
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SIGNOFF_API_KEY;
  if (!resendApiKey && !dryRun) {
    throw new Error('RESEND_API_KEY is not set');
  }
  const resend = resendApiKey ? new Resend(resendApiKey) : null;

  const recipient = {
    name: 'Chris Metzger S',
    email: 'chris.metzger@retailodyssey.com',
    storeId: '652',
    shiftDateLabel: 'Fri, Jun 19',
  };

  if (dryRun) {
    console.log(`DRY RUN: would email ${recipient.name} <${recipient.email}> for FM ${recipient.storeId} on ${recipient.shiftDateLabel}`);
    return;
  }

  const result = await fruitAuditTrackerNotify.sendD6FruitAuditShiftInvite(resend, {
    name: recipient.name,
    email: recipient.email,
    storeId: recipient.storeId,
    shiftDateLabel: recipient.shiftDateLabel,
    dashboardUrl: DASHBOARD_URL,
    fieldAppUrl: FIELD_APP_URL,
    cc: CC,
  });

  if (!result.ok) {
    console.error(`Failed for ${recipient.email}:`, result.error || result.skipped || 'unknown');
    process.exit(1);
  }
  console.log(`Sent FM ${recipient.storeId} shift invite to ${recipient.email} (id: ${result.id || 'n/a'})`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
