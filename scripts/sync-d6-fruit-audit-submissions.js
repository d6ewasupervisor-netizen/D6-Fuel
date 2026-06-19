#!/usr/bin/env node
'use strict';

/**
 * Record verified D6 fruit audit submissions on the hosted tracker.
 * Use after confirming photos landed in the OneDrive D6 folder.
 */

const COMPLETIONS = [
  {
    storeId: '351',
    assigneeName: 'Saviya Hurley Joanne',
    assigneeEmail: 'saviya.hurley@retailodyssey.com',
    photoCount: 30,
    setCount: 3,
  },
  {
    storeId: '652',
    assigneeName: 'Chris Metzger S',
    assigneeEmail: 'chris.metzger@retailodyssey.com',
    photoCount: 13,
    setCount: 3,
  },
  {
    storeId: '654',
    assigneeName: 'Cindy Roth L',
    assigneeEmail: 'cindy.roth@sasretailservices.com',
    photoCount: 12,
    setCount: 3,
  },
];

const API_BASE = process.env.D6_FRUIT_AUDIT_API_BASE
  || 'https://fuel.retail-odyssey.com/api/fruit-audit-tracker/6';
const SUPERVISOR_EMAIL = process.env.D6_FRUIT_AUDIT_SUPERVISOR_EMAIL
  || 'tyson.gauthier@retailodyssey.com';
const SUPERVISOR_NAME = process.env.D6_FRUIT_AUDIT_SUPERVISOR_NAME
  || 'Tyson Gauthier';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  for (const entry of COMPLETIONS) {
    const payload = {
      email: SUPERVISOR_EMAIL,
      name: SUPERVISOR_NAME,
      ...entry,
    };
    if (dryRun) {
      console.log(`DRY RUN: would record FM ${entry.storeId} for ${entry.assigneeEmail}`);
      continue;
    }
    const response = await fetch(`${API_BASE}/record-completion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`FM ${entry.storeId}: ${body.error || response.statusText}`);
    }
    console.log(body.message || `FM ${entry.storeId} recorded complete`);
  }

  if (!dryRun) {
    const snapshot = await fetch(API_BASE).then(res => res.json());
    console.log(`Tracker now ${snapshot.stats.complete}/${snapshot.stats.total} complete`);
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
