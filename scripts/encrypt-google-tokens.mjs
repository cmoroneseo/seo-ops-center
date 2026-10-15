#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('../lib/security/google-token-backfill-cli.ts', import.meta.url));
const child = spawnSync(process.execPath, ['--import', 'tsx', entry, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(child.status ?? 1);
