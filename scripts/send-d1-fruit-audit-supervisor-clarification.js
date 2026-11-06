#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Resend } = require('resend');
const fruitAuditTrackerNotify = require('../lib/fruit-audit-tracker-notify');

const TYSON_EMAIL = 'tyson.gauthier@retailodyssey.com';
const TARGET_STORES = ['063', '218', '242', '285', '375', '377', '393', '462', '516', '651'];
const TODAY = '2026-06-19';
const SAS_PROJECTS = [1, 1668, 1715, 3568, 9293, 9295, 1366, 1364, 1367, 8081];

async function loadSasToken() {
  const fs = require('fs');
  const statePath = process.env.SAS_AUTH_STATE || 'C:/Users/tgaut/sas-auth/.sas-session/auth-state.json';
  const sessionUrl = process.env.SAS_AUTH_SESSION_URL || 'http://127.0.0.1:7291/session';
  if (fs.existsSync(statePath)) {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (state?.auth?.auth_token) return String(state.auth.auth_token);
  }
  const res = await fetch(sessionUrl);
  const body = await res.json();
  if (!body?.auth?.auth_token) throw new Error('No SAS session available');
  return String(body.auth.auth_token);
}

async function sasGet(token, urlPath, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const res = await fetch(`https://prod.sasretail.com/api/v1${urlPath}?${qs}`, {
    headers: {
      Accept: 'application/json',
      Authorization: `Token ${token}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  if (!res.ok) throw new Error(`SAS ${res.status} ${urlPath}`);
  return res.json();
}

async function fetchRecipientsForStores(token, storeIds) {
  const emails = new Set();
  for (const projectId of SAS_PROJECTS) {
    let cycle;
    try {
      const body = await sasGet(token, '/projects/project-cycles/', {
        current_status: 'active', page: 1, page_size: 20, project: projectId, sort: 'start_date',
      });
      const cycles = body.results || body || [];
      cycle = cycles.find(c => c.start_date <= TODAY && c.end_date >= TODAY) || cycles[0];
    } catch { continue; }
    if (!cycle) continue;

    let visits = [];
    try {
      const body = await sasGet(token, '/team-scheduling/visits/', {
        cycle: cycle.id, page: 1, page_size: 500,
      });
      visits = body.results || body || [];
    } catch { continue; }

    for (const visit of visits.filter(v => String(v.scheduled_date) === TODAY)) {
      const raw = visit.store?.store?.number ?? visit.store?.number ?? visit.store_name?.number;
      const store = String(raw || '').replace(/\D/g, '').padStart(3, '0');
      if (!storeIds.includes(store)) continue;
      try {
        const body = await sasGet(token, '/team-scheduling/shifts/', {
          page: 1, page_size: 50, visit: visit.id,
        });
        const shifts = (Array.isArray(body) ? body : (body.results || []))
          .filter(s => s.current_status !== 'deleted');
        for (const shift of shifts) {
          const person = shift.employee?.person || shift.employee || {};
          const email = String(person.email || '').trim();
          if (email) emails.add(email);
        }
      } catch { /* continue */ }
    }
  }
  return [...emails].sort();
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const token = await loadSasToken();
  const recipients = await fetchRecipientsForStores(token, TARGET_STORES);
  console.log(`Recipients (${recipients.length}): ${recipients.join(', ')}`);
  if (!recipients.length) throw new Error('No recipients found');
  if (dryRun) return;

  const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SIGNOFF_API_KEY;
  if (!resendApiKey) throw new Error('RESEND_API_KEY is not set');

  const result = await fruitAuditTrackerNotify.sendD1FruitAuditSupervisorClarification(new Resend(resendApiKey), {
    recipients,
    fromEmail: TYSON_EMAIL,
    cc: [TYSON_EMAIL],
  });
  if (!result.ok) throw new Error(result.error || result.reason || 'send failed');
  console.log(`Clarification email sent (id: ${result.id || 'n/a'})`);
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
