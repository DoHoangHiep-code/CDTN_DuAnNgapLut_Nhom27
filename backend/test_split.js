const fs = require('fs');
const sql = fs.readFileSync('init-system/01_schema.sql', 'utf-8');
const statements = sql
  .split(/;\s*\n/)
  .map(s => s.trim())
  .filter(s => s && !s.startsWith('--') && s.length > 5);

statements.forEach((s, i) => {
  console.log(`[${i}] ${s.slice(0, 100).replace(/\n/g, ' ')}...`);
});
