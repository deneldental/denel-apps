import pg from 'pg';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL
});

async function main() {
  await client.connect();
  console.log("Connected");
  await client.query(`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "visit_frequency" text DEFAULT 'single' NOT NULL;`);
  console.log("Migration applied");
  await client.end();
}

main().catch(console.error);
