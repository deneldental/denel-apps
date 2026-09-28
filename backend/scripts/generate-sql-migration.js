const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: 'postgresql://postgres:postgres@localhost:5432/framada' });
  
  const result = await pool.query(`
    SELECT table_name, column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND data_type = 'numeric'
      AND column_name NOT ILIKE '%rate%'
      AND column_name NOT ILIKE '%percent%'
      AND table_name NOT IN ('drizzle_migrations')
  `);
  
  const alters = result.rows.map(row => {
    return `ALTER TABLE "${row.table_name}" ALTER COLUMN "${row.column_name}" TYPE integer USING ROUND("${row.column_name}" * 100)::integer;`;
  });
  
  const fs = require('fs');
  fs.writeFileSync('./migrations/0197_dinero_migration.sql', alters.join('\n'));
  console.log(`Generated 0197_dinero_migration.sql with ${alters.length} alterations.`);
  
  await pool.end();
}

main().catch(console.error);
