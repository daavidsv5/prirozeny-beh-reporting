/**
 * migrate.js — vytvoří tabulku users v PostgreSQL (pokud ještě neexistuje).
 *
 * Spuštění:
 *   node --env-file=.env.local scripts/migrate.js
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  console.log('Spouštím migraci...');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT        PRIMARY KEY,
      email         TEXT        NOT NULL UNIQUE,
      name          TEXT        NOT NULL,
      password_hash TEXT        NOT NULL,
      role          TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_email_idx ON users (LOWER(email))
  `);

  console.log('✅ Migrace dokončena — tabulka users je připravena.');
  await pool.end();
}

main().catch(err => {
  console.error('❌ Chyba při migraci:', err.message);
  process.exit(1);
});
