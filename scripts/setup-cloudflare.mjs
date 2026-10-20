import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

// All credentials go through stdin or structured process arguments, never shell interpolation.
// Wrangler output is captured because error messages may include connection details.
const root = new URL('../', import.meta.url);
process.chdir(fileURLToPath(root));
const settings = {};
for (const file of ['.env', '.dev.vars']) {
  try { Object.assign(settings, parse(await readFile(file))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const secrets = {};
for (const key of ['DATABASE_URL', 'ADMIN_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_WEBHOOK_URL']) {
  const value = process.env[key] ?? settings[key];
  if (value) secrets[key] = value;
}
if (!secrets.DATABASE_URL || !secrets.ADMIN_TOKEN) {
  console.error('Set DATABASE_URL and ADMIN_TOKEN in .env or .dev.vars before running setup.');
  process.exit(1);
}
const privateValues = [...Object.values(secrets)];
let database;
try {
  database = new URL(secrets.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error();
  privateValues.push(decodeURIComponent(database.password), database.password);
} catch {
  console.error('DATABASE_URL must be a PostgreSQL connection URI.');
  process.exit(1);
}
function safeOutput(value) {
  let result = value;
  for (const secret of privateValues.filter(Boolean).sort((a, b) => b.length - a.length)) result = result.split(secret).join('[REDACTED]');
  return result.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_DATABASE_URL]');
}
function wrangler(args, input) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding: 'utf8', input, env: process.env, timeout: 180000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(safeOutput(result.stderr || result.stdout || result.error?.message || 'Cloudflare command failed.'));
  }
  return result.stdout;
}

let temporary;
try {
  const identity = wrangler(['whoami']);
  if (/not (?:authenticated|logged in)/i.test(identity)) throw new Error('Run npx wrangler login in this terminal, then rerun npm run cf:setup.');
  if (process.argv.includes('--check')) {
    console.log('Cloudflare authentication and local secret files are ready. No remote changes made.');
    process.exit(0);
  }

  // Match configured accounts when a developer belongs to multiple Cloudflare accounts.
  const accountIds = [...new Set(identity.match(/\b[a-f0-9]{32}\b/gi) ?? [])];
  if (!process.env.CLOUDFLARE_ACCOUNT_ID && accountIds.length === 1) process.env.CLOUDFLARE_ACCOUNT_ID = accountIds[0];
  if (!process.env.CLOUDFLARE_ACCOUNT_ID && accountIds.length > 1) throw new Error('Set CLOUDFLARE_ACCOUNT_ID to the account that owns the veriq Worker, then rerun setup.');

  const source = await readFile('wrangler.jsonc', 'utf8');
  const activeConfig = source.replace(/^\s*\/\/.*$/gm, '');
  const hasBinding = /"binding"\s*:\s*"HYPERDRIVE"/.test(activeConfig);
  if (!hasBinding && database.hostname.endsWith('.pooler.supabase.com')) {
    temporary = await mkdtemp(join(tmpdir(), 'veriq-cloudflare-'));
    const pemSource = await readFile('src/infrastructure/database/supabase-ca.ts', 'utf8');
    const pem = pemSource.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)?.[0];
    if (!pem) throw new Error('Bundled Supabase CA certificate is missing.');
    const certPath = join(temporary, 'supabase-ca.pem');
    await writeFile(certPath, pem + '\n');
    console.log('Uploading Supabase CA certificate...');
    const uploaded = wrangler(['cert', 'upload', 'certificate-authority', '--ca-cert', certPath, '--name', 'veriq-supabase-ca']);
    const certificateId = uploaded.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)?.[0];
    if (!certificateId) throw new Error('Could not read the CA certificate ID. Inspect Cloudflare Certificates before rerunning setup.');
    // Hyperdrive itself pools connections, so use Supabase session mode as its origin.
    const origin = new URL(database);
    if (origin.port === '6543') origin.port = '5432';
    origin.search = '';
    privateValues.push(origin.toString());
    console.log('Creating Hyperdrive with verified TLS and query caching disabled...');
    const created = wrangler(['hyperdrive', 'create', 'veriq-db', '--connection-string', origin.toString(), '--ca-certificate-id', certificateId, '--sslmode', 'verify-full', '--caching-disabled', '--binding', 'HYPERDRIVE', '--update-config']);
    const updated = (await readFile('wrangler.jsonc', 'utf8')).replace(/^\s*\/\/.*$/gm, '');
    if (!/"binding"\s*:\s*"HYPERDRIVE"/.test(updated)) {
      await mkdir('.wrangler', { recursive: true });
      await writeFile('.wrangler/hyperdrive-setup-output.txt', safeOutput(created), { mode: 0o600 });
      throw new Error('Hyperdrive was created, but the binding was not added. See .wrangler/hyperdrive-setup-output.txt for the configuration to add to wrangler.jsonc.');
    }
    console.log('HYPERDRIVE binding added to wrangler.jsonc.');
  } else if (hasBinding) console.log('Using the existing HYPERDRIVE binding in wrangler.jsonc.');

  console.log('Uploading Worker secrets from local environment files...');
  wrangler(['secret', 'bulk'], JSON.stringify(secrets));
  console.log('Cloudflare setup complete. Run npm run cf:deploy, then check /health on your Worker URL.');
} catch (error) {
  console.error(safeOutput(error instanceof Error ? error.message : 'Cloudflare setup failed.'));
  process.exitCode = 1;
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
