import 'dotenv/config';
import { existsSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const databaseDir = path.join(root, 'database');
const migrationsDir = path.join(databaseDir, 'migrations');

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function normalizeSupabaseDbUrl(databaseUrl) {
  // Allow users to pass either SUPABASE_DB_URL or DATABASE_URL.
  // Postgres connection string often looks like:
  //   postgres://user:pass@host:5432/db?sslmode=require
  // Some tools/docs use `?sslmode=require`; Postgres expects it.
  // Supabase may also provide `postgresql://...`.
  const raw = String(databaseUrl ?? '').trim();
  if (!raw) return raw;
  // Keep as-is; just normalize scheme casing.
  return raw.replace(/^PostgreSQL:\/\//i, 'postgres://').replace(/^Postgresql:\/\//i, 'postgres://');
}


function collectSqlFiles() {
  const files = [];
  const schemaPath = path.join(databaseDir, 'schema.sql');
  if (existsSync(schemaPath)) files.push(schemaPath);

  if (existsSync(migrationsDir)) {
    for (const name of readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort()) {
      files.push(path.join(migrationsDir, name));
    }
  }

  for (const name of readdirSync(databaseDir).filter((file) => file.endsWith('.sql') && file !== 'schema.sql').sort()) {
    files.push(path.join(databaseDir, name));
  }

  return [...new Set(files)];
}

function runPsqlFile(databaseUrl, filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['--set', 'ON_ERROR_STOP=1', databaseUrl, '--file', filePath], {
      stdio: 'inherit',
      shell: false,
      windowsHide: true,
    });

    child.on('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error('psql was not found. Install PostgreSQL tools, then rerun npm run restore.'));
        return;
      }
      reject(error);
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql failed for ${path.relative(root, filePath)} with exit code ${code}.`));
    });
  });
}

async function main() {
  const databaseUrlRaw = env('SUPABASE_DB_URL') || env('DATABASE_URL');
  const databaseUrl = normalizeSupabaseDbUrl(databaseUrlRaw);
  if (!databaseUrl) {
    throw new Error('Set SUPABASE_DB_URL or DATABASE_URL to your Supabase Postgres connection string.');
  }


  const files = collectSqlFiles();
  if (!files.length) throw new Error('No SQL files found in database/.');

  console.log(`Restoring ${files.length} SQL file(s):`);
  for (const file of files) console.log(`- ${path.relative(root, file)}`);

  for (const file of files) {
    console.log(`\n[restore] ${path.relative(root, file)}`);
    await runPsqlFile(databaseUrl, file);
  }

  console.log('\nDatabase restore complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
