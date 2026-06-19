#!/usr/bin/env node
'use strict';

/**
 * Assign Chris Metzger to FM 652 and send the assignment confirmation email.
 * Uses the shared D6 supervisor assign script.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const args = [
  path.join(__dirname, 'assign-d6-fruit-audit.js'),
  '--store', '652',
  '--name', 'Chris Metzger S',
  '--email', 'chris.metzger@retailodyssey.com',
  ...process.argv.slice(2),
];

const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(result.status == null ? 1 : result.status);
