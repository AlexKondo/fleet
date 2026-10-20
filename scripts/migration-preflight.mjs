// Read-only deployment planning. This program never connects to or changes a database.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function topLevelSql(sql) {
  let result = '', i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; result += ' '; continue;
    }
    if (sql.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith('/*', i)) { depth++; i += 2; }
        else if (sql.startsWith('*/', i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error('Unterminated SQL comment');
      result += ' '; continue;
    }
    const dollar = sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end < 0) throw new Error('Unterminated SQL body');
      i = end + dollar.length; result += ' body '; continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++]; let closed = false;
      while (i < sql.length) {
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue; }
          closed = true; break;
        }
      }
      if (!closed) throw new Error('Unterminated SQL literal');
      result += ' literal '; continue;
    }
    result += sql[i++];
  }
  return result;
}

export function planMigrations(files, appliedVersions) {
  if (!Array.isArray(appliedVersions) || appliedVersions.some(v => typeof v !== 'string' || !/^\d+$/.test(v)))
    throw new Error('History must be a JSON array of migration version strings. Missing history is not an empty database.');
  if (new Set(appliedVersions).size !== appliedVersions.length) throw new Error('Duplicate history versions');
  const applied = new Set(appliedVersions);
  const seen = new Set();
  const ordered = files.map(({name, sql}) => {
    const version = name.match(/^(\d+)_.+\.sql$/)?.[1];
    if (!version || seen.has(version)) throw new Error('Invalid or duplicate migration version');
    seen.add(version); return { name, sql, version };
  }).sort((a,b) => a.version.localeCompare(b.version));
  const unknown = appliedVersions.filter(v => !seen.has(v));
  const lastApplied = ordered.findLastIndex(f => applied.has(f.version));
  const pending = ordered.filter(f => !applied.has(f.version)).map(f => {
    const sql = topLevelSql(f.sql);
    const reasons = [];
    if (/(?:^|;)\s*(?:truncate\b|delete\s+from\b|drop\s+(?:table|schema)\b|alter\s+table\b[^;]*\bdrop\s+(?:column\s+)?)/i.test(sql))
      reasons.push('DATA_DESTRUCTIVE_SQL');
    if (/(?:^|;)\s*do\b/i.test(sql)) reasons.push('PROCEDURAL_BLOCK_REQUIRES_REVIEW');
    if (ordered.indexOf(f) < lastApplied) reasons.push('HISTORY_GAP');
    return {version:f.version, name:f.name, reasons};
  });
  return {
    readOnly: true, executesSql: false,
    status: unknown.length || pending.some(f=>f.reasons.length) ? 'BLOCKED_REVIEW_REQUIRED' : 'PLAN_READY_FOR_ENVIRONMENT_VALIDATION',
    unknownAppliedVersions: unknown, pending,
    warning: 'A clean plan is not approval to deploy, a backup, or proof of database/schema equivalence. Review pending SQL and validate in homologation.',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--history') throw new Error('Usage: node scripts/migration-preflight.mjs --history /path/applied-versions.json');
    const directory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
    const files = readdirSync(directory).filter(n=>/^\d+_.+\.sql$/.test(n)).map(name=>({name,sql:readFileSync(path.join(directory,name),'utf8')}));
    const result = planMigrations(files, JSON.parse(readFileSync(args[1], 'utf8')));
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    if (result.status === 'BLOCKED_REVIEW_REQUIRED') process.exitCode = 2;
  } catch (error) {
    // Never print file contents, supplied SQL or environment values.
    process.stderr.write('Preflight failed: '+(error instanceof SyntaxError ? 'Invalid JSON history' : error.message)+'\n');
    process.exitCode = 1;
  }
}
