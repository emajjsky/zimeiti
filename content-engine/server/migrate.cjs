const fs = require('node:fs/promises');
const path = require('node:path');
const { query, transaction, close } = require('./db.cjs');

async function migrate() {
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const dir = path.join(__dirname, 'migrations');
  const files = (await fs.readdir(dir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const existing = await query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (existing.rowCount) continue;
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    await transaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    process.stdout.write(`已应用迁移 ${file}\n`);
  }
}

migrate().then(() => close()).catch(async (error) => { console.error(error); await close(); process.exitCode = 1; });
