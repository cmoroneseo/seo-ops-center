#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const target = process.env.SECURITY_ENV_TARGET || process.env.VERCEL_ENV || process.env.NODE_ENV || 'development';
const isProduction = target === 'production';

const requiredPublic = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SITE_URL',
];

const requiredServer = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'CRON_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
];

const publicPrefixes = ['NEXT_PUBLIC_'];
const secretNamePattern = /(SECRET|TOKEN|KEY|PASSWORD|PRIVATE|SERVICE_ROLE|WEBHOOK)/i;
const placeholderPattern = /(your_|placeholder|dummy|example|sk_test_dummy|whsec_\.\.\.|sk_test_\.\.\.)/i;
const ignoredDiscoveredKeys = new Set([
  'NODE_ENV',
  'VERCEL_ENV',
  'SECURITY_ENV_TARGET',
  'SECURITY_STATIC_STRICT',
  'SECURITY_STATIC_REPORT',
]);

function read(file) {
  try {
    return fs.readFileSync(path.join(repoRoot, file), 'utf8');
  } catch {
    return '';
  }
}

function parseEnvExample() {
  const body = read('.env.example');
  const keys = new Set();
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Z0-9_]+)=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function listFiles(dir, out = []) {
  const fullDir = path.join(repoRoot, dir);
  if (!fs.existsSync(fullDir)) return out;
  for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.next', 'coverage', 'dist'].includes(entry.name)) continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(rel, out);
    else if (/\.(ts|tsx|js|mjs|cjs|sql|md|yml|yaml)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function discoverProcessEnvKeys() {
  const keys = new Set();
  for (const file of listFiles('.')) {
    const body = read(file);
    for (const match of body.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      keys.add(match[1]);
    }
  }
  return keys;
}

const envExampleKeys = parseEnvExample();
const usedEnvKeys = discoverProcessEnvKeys();
const expectedKeys = new Set([...requiredPublic, ...requiredServer]);

for (const key of usedEnvKeys) {
  if (!ignoredDiscoveredKeys.has(key)) expectedKeys.add(key);
}

const findings = [];

for (const key of expectedKeys) {
  if (!envExampleKeys.has(key)) {
    findings.push({
      severity: 'medium',
      message: `${key} is used or required but missing from .env.example.`,
    });
  }
}

for (const key of envExampleKeys) {
  const isPublic = publicPrefixes.some((prefix) => key.startsWith(prefix));
  if (isPublic && secretNamePattern.test(key) && key !== 'NEXT_PUBLIC_SUPABASE_ANON_KEY') {
    findings.push({
      severity: 'high',
      message: `${key} is public but looks secret-bearing. Rename it or keep it server-only.`,
    });
  }
}

if (isProduction) {
  for (const key of [...requiredPublic, ...requiredServer]) {
    const value = process.env[key];
    if (!value) {
      findings.push({
        severity: 'critical',
        message: `${key} is required for production readiness but is not set.`,
      });
      continue;
    }
    if (placeholderPattern.test(value)) {
      findings.push({
        severity: 'critical',
        message: `${key} contains a placeholder-like value in production target.`,
      });
    }
  }

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && !/^https:\/\/.+\.supabase\.co$/.test(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    findings.push({
      severity: 'high',
      message: 'NEXT_PUBLIC_SUPABASE_URL does not look like a production Supabase project URL.',
    });
  }
}

const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
const maxSeverity = findings.reduce((max, finding) => Math.max(max, severityRank[finding.severity] ?? 0), 0);

console.log(`# Environment Security Check\n`);
console.log(`Target: ${target}`);
console.log(`Production enforcement: ${isProduction ? 'on' : 'off'}\n`);

if (findings.length === 0) {
  console.log('No environment hygiene findings.');
} else {
  for (const finding of findings) {
    console.log(`- [${finding.severity.toUpperCase()}] ${finding.message}`);
  }
}

if (maxSeverity >= severityRank.critical || (isProduction && maxSeverity >= severityRank.high)) {
  process.exitCode = 1;
}
