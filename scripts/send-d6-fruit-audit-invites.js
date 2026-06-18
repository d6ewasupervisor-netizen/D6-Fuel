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

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SIGNOFF_API_KEY;
  if (!resendApiKey && !dryRun) {
    throw new Error('RESEND_API_KEY is not set');
  }
  const resend = resendApiKey ? new Resend(resendApiKey) : null;

  for (const recipient of RECIPIENTS) {
    if (dryRun) {
      console.log(`DRY RUN: would invite ${recipient.name} <${recipient.email}>`);
      continue;
    }
    const result = await fruitAuditTrackerNotify.sendD6FruitAuditInvite(resend, {
      name: recipient.name,
      email: recipient.email,
      dashboardUrl: DASHBOARD_URL,
      fieldAppUrl: FIELD_APP_URL,
      cc: CC,
    });
    if (!result.ok) {
      console.error(`Failed for ${recipient.email}:`, result.error || result.skipped || 'unknown');
    } else {
      console.log(`Sent invite to ${recipient.email} (id: ${result.id || 'n/a'})`);
    }
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
