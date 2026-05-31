const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL_POOLER || process.env.DATABASE_URL || 'postgresql://hiep1234561:-WIbZmFLHwEH6a2CCL76CA@crab-deer-16109.jxf.gcp-asia-southeast1.cockroachlabs.cloud:26257/defaultdb?sslmode=verify-full'
});

async function dumpSchema() {
  await client.connect();
  try {
    const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    let schemaDump = '';
    for (const row of res.rows) {
      const tableName = row.table_name;
      try {
        const createRes = await client.query(`SHOW CREATE TABLE ${tableName}`);
        if (createRes.rows.length > 0) {
          const createStmt = createRes.rows[0].create_statement;
          schemaDump += `-- Table: ${tableName}\n`;
          schemaDump += createStmt + ';\n\n';
        }
      } catch (e) {
        console.error(`Error dumping ${tableName}: ${e.message}`);
      }
    }
    
    // Get materialized views
    const mvRes = await client.query("SELECT table_name FROM information_schema.views WHERE table_schema = 'public'");
    for (const row of mvRes.rows) {
        const viewName = row.table_name;
        // CockroachDB might not show MVs in information_schema.views, it might be in tables
    }
    
    // Actually CockroachDB SHOW CREATE TABLE works for materialized views too, which are listed in information_schema.tables but with table_type = 'VIEW' maybe? 
    // Wait, let's just query crdb_internal.tables
    const allRes = await client.query("SELECT name FROM crdb_internal.tables WHERE schema_name = 'public'");
    for (const row of allRes.rows) {
        const name = row.name;
        if (name.includes('sequelizemeta')) continue;
        try {
            const createRes = await client.query(`SHOW CREATE TABLE ${name}`);
            if (createRes.rows.length > 0) {
                schemaDump += `-- Entity: ${name}\n`;
                schemaDump += createRes.rows[0].create_statement + ';\n\n';
            }
        } catch(e) {}
    }
    
    console.log(schemaDump);
  } finally {
    await client.end();
  }
}

dumpSchema().catch(console.error);
