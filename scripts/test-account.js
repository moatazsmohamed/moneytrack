/*
 * Test-only helper: creates or removes a verified USER account for browser smoke tests.
 *   node scripts/test-account.js create <email> <password>
 *   node scripts/test-account.js delete <email>
 * Only reserved example.test addresses are accepted, so real accounts can never be touched.
 */
import crypto from 'node:crypto';
import { query, transaction, seedWorkspace, deleteAccount, closePool } from '../server/db.js';
import { hashPassword } from '../server/security.js';

const [action, email, password] = process.argv.slice(2);
if (!/^mt-ui-[a-z0-9-]+@example\.test$/.test(String(email || ''))) {
  console.error('Use an address of the form mt-ui-<name>@example.test');
  process.exit(2);
}
try {
  if (action === 'create') {
    if (!password || password.length < 12) throw new Error('A test password of at least 12 characters is required');
    const id = crypto.randomUUID();
    const hash = await hashPassword(password);
    await transaction(async (conn) => {
      await conn.execute("INSERT INTO mt_profiles (id,email,password_hash,full_name,status,email_verified,must_change_password) VALUES (?,?,?,?, 'active', TRUE, FALSE)", [id, email, hash, 'UI Smoke Test']);
      await conn.execute("INSERT INTO mt_user_roles (user_id,role,permissions_json) VALUES (?, 'USER', '[]')", [id]);
      await seedWorkspace(id, conn, 'ar');
    });
    console.log(`created ${email}`);
  } else if (action === 'delete') {
    const rows = await query('SELECT id FROM mt_profiles WHERE email=?', [email]);
    for (const row of rows) await transaction((conn) => deleteAccount(conn, row.id));
    console.log(`deleted ${rows.length} account(s)`);
  } else {
    throw new Error('Unknown action');
  }
} finally {
  await closePool();
}
