#!/usr/bin/env node
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');
const { loadSasSession } = require('C:/Users/tgaut/kompass-netcap/lib/sas-session');
const { init, getTracker } = require('../lib/fruit-audit-district-trackers');
const fruitAuditTrackerNotify = require('../lib/fruit-audit-tracker-notify');
const fruitAuditManifest = require('../data/fruit-audit-manifest.json');

const DISTRICT = '1';
const TYSON_EMAIL = 'tyson.gauthier@retailodyssey.com';
const DASHBOARD_URL = 'https://fuel.retail-odyssey.com/fruit-audit-dashboard?district=1';
const FIELD_APP_URL = 'https://fuel.retail-odyssey.com/fruit-audit?district=1';
const PHOTO_STORES = new Set(['035', '040', '060', '143', '153', '220', '240', '482', '661', '694']);
const TODAY = '2026-06-19';
const SAS_PROJECTS = [1, 1668, 1715, 3568, 9293, 9295, 1366, 1364, 1367, 8081];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false, skipEmail: false, skipOpen: false };
  for (const arg of args) {
    if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--skip-email') out.skipEmail = true;
    else if (arg === '--skip-open') out.skipOpen = true;
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

function d1StoreIds() {
  const district = (fruitAuditManifest.districts || []).find(d => String(d.id) === DISTRICT);
  return district && Array.isArray(district.storeIds) ? district.storeIds : [];
}

function targetStoreIds(tracker) {
  const snapshot = tracker.buildSnapshot();
  const complete = new Set(
    (snapshot.stores || [])
      .filter(store => store.status === 'complete')
      .map(store => store.id),
  );
  return d1StoreIds().filter(storeId => !PHOTO_STORES.has(storeId) && !complete.has(storeId));
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function phoneFromPerson(person) {
  if (!person) return '';
  return person.phone_number || person.phone || person.cell_phone || '';
}

async function sasGet(token, urlPath, params = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null && v !== '') qs.set(k, String(v));
  }
  const url = `https://prod.sasretail.com/api/v1${urlPath}${qs.toString() ? `?${qs}` : ''}`;
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      Authorization: `Token ${token}`,
      'X-Requested-With': 'XMLHttpRequest',
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`SAS ${res.status} ${urlPath}`);
  return body;
}

function visitStoreNumber(visit) {
  const raw = visit.store?.store?.number ?? visit.store?.number ?? visit.store_name?.number ?? null;
  const digits = String(raw || '').replace(/\D/g, '');
  return digits ? digits.padStart(3, '0') : null;
}

async function getActiveCycle(token, projectId) {
  const body = await sasGet(token, '/projects/project-cycles/', {
    current_status: 'active',
    page: 1,
    page_size: 20,
    project: projectId,
    sort: 'start_date',
  });
  const cycles = body.results || body || [];
  return cycles.find(c => c.start_date <= TODAY && c.end_date >= TODAY) || cycles[0] || null;
}

async function getShifts(token, visitId) {
  const body = await sasGet(token, '/team-scheduling/shifts/', {
    page: 1,
    page_size: 50,
    visit: visitId,
  });
  const rows = Array.isArray(body) ? body : (body.results || []);
  return rows.filter(s => s.current_status !== 'deleted');
}

async function fetchStoreContacts(token, storeIds) {
  const contactsByStore = new Map(storeIds.map(id => [id, new Map()]));

  for (const projectId of SAS_PROJECTS) {
    let cycle;
    try {
      cycle = await getActiveCycle(token, projectId);
    } catch (err) {
      continue;
    }
    if (!cycle) continue;

    let visits = [];
    try {
      const body = await sasGet(token, '/team-scheduling/visits/', {
        cycle: cycle.id,
        page: 1,
        page_size: 500,
      });
      visits = body.results || body || [];
    } catch (err) {
      continue;
    }

    const todayVisits = visits.filter(v => String(v.scheduled_date) === TODAY);
    for (const visit of todayVisits) {
      const store = visitStoreNumber(visit);
      if (!store || !contactsByStore.has(store)) continue;
      const bucket = contactsByStore.get(store);
      try {
        const shifts = await getShifts(token, visit.id);
        for (const shift of shifts) {
          const emp = shift.employee;
          if (!emp) continue;
          const person = emp.person || emp;
          const email = String(person.email || '').trim();
          const name = String(person.person_name || person.name || '').trim();
          if (!email || !name) continue;
          const key = normalizeEmail(email);
          if (!bucket.has(key)) {
            bucket.set(key, { name, email, phone: phoneFromPerson(person) });
          }
        }
      } catch (err) {
        // keep going
      }
    }
  }

  const out = {};
  for (const storeId of storeIds) {
    out[storeId] = [...(contactsByStore.get(storeId) || new Map()).values()];
  }
  return out;
}

function defaultAssigneeForStore(tracker, storeId) {
  const assignments = tracker.defaultAssignmentsByStore[storeId] || [];
  return assignments[0] || null;
}

async function main() {
  const result = await runOpenD1VolunteerStores(parseArgs());
  if (result && result.productionOpenStores) {
    console.log(`Production open stores now: ${result.productionOpenStores.join(', ') || '(none)'}`);
  }
}

async function runOpenD1VolunteerStores(options = {}) {
  const { dryRun = false, skipEmail = false, skipOpen = false } = options;
  const dataPath = trackerDataPath();
  console.log(`Tracker state: ${dataPath}`);

  init({ baseDataPath: dataPath });
  const tracker = getTracker(DISTRICT);
  const targetStores = targetStoreIds(tracker);
  if (!targetStores.length) {
    console.log('No remaining D1 stores to open (outside photo set and already complete).');
    return { targetStores: [], released: [], emails: [] };
  }
  console.log(`Target stores: ${targetStores.join(', ')}`);

  let snapshot = tracker.buildSnapshot();
  let released = [];
  if (!skipOpen) {
    if (dryRun) {
      console.log(`DRY RUN: would open ${targetStores.length} store(s) and release current assignees.`);
    } else {
      const result = tracker.openStoresForVolunteerSignup(targetStores);
      released = result.released || [];
      snapshot = result.snapshot;
      console.log(`Opened: ${(result.opened || []).join(', ')}`);
      if (released.length) {
        console.log(`Released ${released.length} assignment(s): ${released.map(p => `${p.name} @ FM ${p.storeId}`).join('; ')}`);
      }
      if (result.skipped && result.skipped.length) {
        console.log('Skipped:', result.skipped);
      }
    }
  }

  const { token } = await loadSasSession();
  const contactsByStore = await fetchStoreContacts(token, targetStores);
  const emails = [];

  for (const storeId of targetStores) {
    const assignee = defaultAssigneeForStore(tracker, storeId);
    const sasContacts = contactsByStore[storeId] || [];
    const recipientMap = new Map();
    for (const contact of sasContacts) {
      recipientMap.set(normalizeEmail(contact.email), contact.email);
    }
    if (assignee && assignee.email) {
      recipientMap.set(normalizeEmail(assignee.email), assignee.email);
    }
    const recipients = [...recipientMap.values()];
    const preferredLabel = assignee && assignee.scheduledLabel ? assignee.scheduledLabel : 'Fri 6/19';
    console.log(`FM ${storeId}: ${recipients.length} recipient(s) -> ${recipients.join(', ') || '(none)'}`);

    if (skipEmail || !recipients.length) continue;
    if (dryRun) {
      console.log(`DRY RUN: would email FM ${storeId} team (${recipients.join(', ')})`);
      emails.push({ storeId, recipients, dryRun: true });
      continue;
    }

    const resendApiKey = process.env.RESEND_API_KEY || process.env.RESEND_SIGNOFF_API_KEY;
    if (!resendApiKey) throw new Error('RESEND_API_KEY is not set');
    const resend = new Resend(resendApiKey);
    const result = await fruitAuditTrackerNotify.sendD1FruitAuditVolunteerAppeal(resend, {
      storeId,
      preferredStoreId: storeId,
      preferredStoreLabel: preferredLabel,
      recipients,
      dashboardUrl: DASHBOARD_URL,
      fieldAppUrl: FIELD_APP_URL,
      snapshot,
      fromEmail: TYSON_EMAIL,
      cc: [TYSON_EMAIL],
    });
    if (!result.ok) {
      throw new Error(`Email failed for FM ${storeId}: ${result.error || result.reason || result.skipped || 'unknown'}`);
    }
    console.log(`Email sent for FM ${storeId} (id: ${result.id || 'n/a'})`);
    emails.push({ storeId, recipients, id: result.id });
  }

  let productionOpenStores = null;
  if (!dryRun && !skipOpen) {
    const verify = await fetch(`${DASHBOARD_URL.replace('fruit-audit-dashboard', 'fruit-audit-tracker')}/1`)
      .then(r => r.json())
      .catch(() => null);
    if (verify && Array.isArray(verify.stores)) {
      productionOpenStores = verify.stores.filter(s => s.status === 'open').map(s => s.id);
    }
  }

  return {
    targetStores,
    released,
    emails,
    snapshot,
    productionOpenStores,
  };
}

module.exports = {
  runOpenD1VolunteerStores,
  PHOTO_STORES,
  DASHBOARD_URL,
};

if (require.main === module) {
  main().catch(err => {
    console.error(err.message || err);
    process.exit(1);
  });
}
