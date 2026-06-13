#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const strict = process.env.SECURITY_STATIC_STRICT === 'true';
const outputPath = process.env.SECURITY_STATIC_REPORT;

const skipDirs = new Set(['node_modules', '.git', '.next', '.claude', 'coverage', 'dist', 'out']);
const textFilePattern = /\.(ts|tsx|js|jsx|mjs|cjs|sql|md|json|yml|yaml)$/;

const rules = [
  {
    id: 'possible-committed-secret',
    severity: 'critical',
    description: 'Possible committed live secret or private credential.',
    pattern: /(sk_live_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{30,}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{20,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/,
    exclude: ['.env.example'],
  },
  {
    id: 'service-role-fallback',
    severity: 'high',
    description: 'Service-role or backend secret has a placeholder/fallback value. Production code should fail closed.',
    pattern: /(SUPABASE_SERVICE_ROLE_KEY|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET)[\s\S]{0,80}\|\|\s*['"`][^'"`]+['"`]/,
  },
  {
    id: 'admin-client-api-route',
    severity: 'high',
    description: 'API route imports or creates a Supabase admin client. Verify auth, tenant authorization, and least-privilege writes.',
    pattern: /createAdminClient|SUPABASE_SERVICE_ROLE_KEY|createClient\(supabaseUrl,\s*supabaseKey\)/,
    include: ['app/api/'],
  },
  {
    id: 'client-supplied-tenant-id',
    severity: 'high',
    description: 'Route appears to accept org/client identifiers from the client. Verify tenant access server-side before reads/writes.',
    pattern: /(searchParams\.get\(['"`](orgId|clientId|organizationId)['"`]\)|const\s*\{[^}]*\b(orgId|clientId|organizationId)\b[^}]*\}\s*=\s*await req\.json)/,
    include: ['app/api/'],
  },
  {
    id: 'oauth-state-not-signed',
    severity: 'high',
    description: 'OAuth state is encoded client context. Sign it, store it server-side, and verify membership on callback.',
    pattern: /(Buffer\.from\(JSON\.stringify\(\{[\s\S]{0,220}state|Buffer\.from\(stateParam,\s*['"`]base64url['"`]\))/,
    include: ['app/api/integrations/'],
  },
  {
    id: 'browser-credential-select',
    severity: 'high',
    description: 'Browser-facing query selects credentials. Return derived status flags from a server route or database view instead.',
    pattern: /\.select\(['"`][^'"`]*credentials[^'"`]*['"`]\)/,
    include: ['components/', 'app/'],
    excludePath: ['app/api/'],
  },
  {
    id: 'broad-storage-policy',
    severity: 'medium',
    description: 'Storage policy is bucket-wide. Prefer object-path constraints tied to org/client ownership.',
    pattern: /ON storage\.objects[\s\S]{0,260}(WITH CHECK|USING)\s*\(\s*bucket_id\s*=\s*['"`][^'"`]+['"`]\s*\)/i,
    include: ['migrations/', 'schema.sql'],
  },
  {
    id: 'mock-auth-bypass',
    severity: 'medium',
    description: 'Mock-mode auth bypass exists. Ensure it cannot run in production or preview with real data.',
    pattern: /(Mock Mode|isMock)[\s\S]{0,240}NextResponse\.next/,
    include: ['middleware.ts', 'lib/supabase/'],
  },
  {
    id: 'sensitive-console-log',
    severity: 'medium',
    description: 'Console logging may expose sensitive data. Redact emails, tokens, provider errors, cookies, and payloads.',
    pattern: /console\.(log|warn|error)\([^;\n]*(email|token|credential|secret|apiKey|session|err|error|payload|body)/i,
  },
  {
    id: 'security-definer-function',
    severity: 'medium',
    description: 'SECURITY DEFINER function needs fixed search_path and minimal behavior review.',
    pattern: /security definer/i,
    include: ['migrations/', 'schema.sql'],
  },
];

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function listFiles(dir = '.', out = []) {
  for (const entry of fs.readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const rel = path.join(dir, entry.name).replace(/^\.\//, '');
    if (entry.isDirectory()) {
      listFiles(rel, out);
    } else if (textFilePattern.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

function matchesPath(file, prefixesOrFiles) {
  if (!prefixesOrFiles) return true;
  return prefixesOrFiles.some((candidate) => file === candidate || file.startsWith(candidate));
}

function isExcludedPath(file, prefixesOrFiles) {
  if (!prefixesOrFiles) return false;
  return prefixesOrFiles.some((candidate) => file === candidate || file.startsWith(candidate));
}

function lineForOffset(body, index) {
  return body.slice(0, index).split(/\r?\n/).length;
}

const findings = [];

for (const file of listFiles()) {
  const body = read(file);
  for (const rule of rules) {
    if (!matchesPath(file, rule.include)) continue;
    if (isExcludedPath(file, rule.excludePath)) continue;
    if (rule.exclude?.includes(file)) continue;
    const match = body.match(rule.pattern);
    if (!match) continue;
    findings.push({
      rule: rule.id,
      severity: rule.severity,
      file,
      line: lineForOffset(body, match.index ?? 0),
      description: rule.description,
    });
  }
}

const severityRank = { critical: 4, high: 3, medium: 2, low: 1 };
findings.sort((a, b) => {
  const severityDiff = (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0);
  if (severityDiff) return severityDiff;
  return `${a.file}:${a.line}:${a.rule}`.localeCompare(`${b.file}:${b.line}:${b.rule}`);
});

const lines = [];
lines.push('# Static Security Review');
lines.push('');
lines.push(`Mode: ${strict ? 'strict' : 'advisory'}`);
lines.push('');

if (findings.length === 0) {
  lines.push('No static security findings.');
} else {
  for (const finding of findings) {
    lines.push(`- [${finding.severity.toUpperCase()}] ${finding.file}:${finding.line} (${finding.rule}) - ${finding.description}`);
  }
}

const report = `${lines.join('\n')}\n`;
console.log(report);

if (outputPath) {
  fs.mkdirSync(path.dirname(path.join(repoRoot, outputPath)), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, outputPath), report);
}

const hasCritical = findings.some((finding) => finding.severity === 'critical');
const hasStrictFailure = strict && findings.some((finding) => severityRank[finding.severity] >= severityRank.medium);

if (hasCritical || hasStrictFailure) {
  process.exitCode = 1;
}
