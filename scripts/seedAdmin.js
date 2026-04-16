/**
 * seedAdmin.js — vytvoří prvního admin uživatele v PostgreSQL.
 *
 * Spuštění:
 *   node --env-file=.env.local scripts/seedAdmin.js [email] [jméno] [heslo]
 *
 * Příklad:
 *   node --env-file=.env.local scripts/seedAdmin.js admin@shoptet.cz "Admin" "HesloMin8Znaků!"
 */

const { Pool } = require('pg');
const crypto   = require('crypto');
const bcrypt   = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const email    = process.argv[2] || 'admin@shoptet.cz';
const name     = process.argv[3] || 'Admin';
const password = process.argv[4] || 'Admin123!';

async function main() {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );

  if (rows.length > 0) {
    console.log(`⚠️  Uživatel ${email} již existuje.`);
    await pool.end();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await pool.query(
    `INSERT INTO users (id, email, name, password_hash, role, created_at)
     VALUES ($1, $2, $3, $4, 'admin', NOW())`,
    [crypto.randomUUID(), email, name, passwordHash]
  );

  console.log(`✅ Admin vytvořen:`);
  console.log(`   Email: ${email}`);
  console.log(`   Heslo: ${password}`);
  console.log(`   Heslo si ihned změňte nebo ho správně zabezpečte.`);

  await pool.end();
}

main().catch(err => {
  console.error('❌ Chyba:', err.message);
  process.exit(1);
});
