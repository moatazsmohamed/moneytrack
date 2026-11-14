import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { hashPassword, normalizeEmail, validateFullName, validatePassword } from '../server/security.js';
import { pool, transaction, uuid, seedWorkspace, closePool } from '../server/db.js';

async function readSecret(prompt) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    const rl = readline.createInterface({ input, output });
    const value = await rl.question(`${prompt}: `);
    rl.close();
    return value;
  }
  output.write(`${prompt}: `);
  input.setRawMode(true);
  let value = '';
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      const text = chunk.toString();
      if (text === '\u0003') { cleanup(); reject(new Error('Cancelled')); return; }
      if (text === '\r' || text === '\n') { cleanup(); output.write('\n'); resolve(value); return; }
      if (text === '\u007f') value = value.slice(0, -1); else value += text;
    };
    const cleanup = () => { input.setRawMode(false); input.off('data', onData); };
    input.on('data', onData);
  });
}

async function main() {
  if (!pool) throw new Error('DATABASE_URL is required.');
  const email = normalizeEmail(process.env.MONEYTRACK_ADMIN_EMAIL || (await (async () => { const rl = readline.createInterface({ input, output }); const value = await rl.question('Admin email: '); rl.close(); return value; })()));
  const password = process.env.MONEYTRACK_ADMIN_PASSWORD || await readSecret('Temporary admin password');
  validatePassword(password, { bootstrap: true });
  const fullName = validateFullName(process.env.MONEYTRACK_ADMIN_NAME || 'MoneyTrack Owner');
  const existing = await pool.execute('SELECT id FROM mt_profiles WHERE email=? LIMIT 1', [email]);
  if (existing[0][0]) {
    process.stdout.write('Bootstrap account already exists; no changes made.\n');
    return;
  }
  const passwordHash = await hashPassword(password, { bootstrap: true });
  await transaction(async (conn) => {
    const id = uuid();
    await conn.execute(`INSERT INTO mt_profiles (id,email,password_hash,full_name,status,email_verified,must_change_password) VALUES (?,?,?,?,'active',TRUE,TRUE)`, [id, email, passwordHash, fullName]);
    await conn.execute(`INSERT INTO mt_user_roles (user_id,role,permissions_json) VALUES (?,'SUPER_ADMIN',?)`, [id, JSON.stringify([])]);
    await seedWorkspace(id, conn);
  });
  process.stdout.write('Bootstrap SUPER_ADMIN created. Change the temporary password at first login.\n');
}

main().catch((error) => { process.stderr.write(`Bootstrap failed: ${error.code || error.message}\n`); process.exitCode = 1; }).finally(async () => { try { await closePool(); } catch { /* best effort */ } });
