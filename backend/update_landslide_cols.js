require('dotenv').config();
const fs = require('fs');
const { Pool } = require('pg');
const csv = require('csv-parser');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/flood_prediction'
});

async function main() {
  const client = await pool.connect();
  console.log('Connected to DB');

  try {
    console.log('Creating temporary table...');
    await client.query(`SET experimental_enable_temp_tables = 'on';`);
    await client.query(`
      CREATE TEMP TABLE temp_landslide_updates (
        lat FLOAT,
        lon FLOAT,
        tpi FLOAT,
        tri FLOAT,
        roughness FLOAT,
        ndwi FLOAT,
        bsi FLOAT,
        lulc_class VARCHAR(50)
      );
    `);

    console.log('Reading CSV and buffering data...');
    const rows = [];
    let processed = 0;

    await new Promise((resolve, reject) => {
      fs.createReadStream('./init-system/02_static_data/grid_prediction_datv3_full_location.csv')
        .pipe(csv())
        .on('data', (data) => {
          // Columns in CSV: lat_x, lon_x, tpi, tri, roughness, ndwi, bsi, lulc_class
          const lat = parseFloat(data.lat_x);
          const lon = parseFloat(data.lon_x);
          if (!isNaN(lat) && !isNaN(lon)) {
            rows.push([
              lat,
              lon,
              data.tpi ? parseFloat(data.tpi) : null,
              data.tri ? parseFloat(data.tri) : null,
              data.roughness ? parseFloat(data.roughness) : null,
              data.ndwi ? parseFloat(data.ndwi) : null,
              data.bsi ? parseFloat(data.bsi) : null,
              data.lulc_class || null
            ]);
          }
          processed++;
          if (processed % 50000 === 0) {
            console.log(`Parsed ${processed} rows...`);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });

    console.log(`Total valid rows to insert into temp table: ${rows.length}`);

    // Batch insert into temp table
    const batchSize = 5000;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      
      const valueStrings = [];
      const queryParams = [];
      let paramCount = 1;

      batch.forEach(row => {
        const rowParams = [];
        row.forEach(val => {
          queryParams.push(val);
          rowParams.push(`$${paramCount++}`);
        });
        valueStrings.push(`(${rowParams.join(', ')})`);
      });

      const query = `INSERT INTO temp_landslide_updates (lat, lon, tpi, tri, roughness, ndwi, bsi, lulc_class) VALUES ${valueStrings.join(', ')}`;
      await client.query(query, queryParams);

      if (i % 50000 === 0) {
        console.log(`Inserted ${i} rows into temp table...`);
      }
    }

    console.log('Finished inserting into temp table. Creating index for fast JOIN...');
    await client.query(`CREATE INDEX temp_landslide_updates_lat_lon_idx ON temp_landslide_updates(ROUND(lat::numeric, 5), ROUND(lon::numeric, 5));`);
    await client.query(`CREATE INDEX IF NOT EXISTS landslide_grid_nodes_lat_lon_func_idx ON landslide_grid_nodes(ROUND(lat::numeric, 5), ROUND(lon::numeric, 5));`);

    console.log('Running bulk UPDATE on landslide_grid_nodes...');
    const result = await client.query(`
      UPDATE landslide_grid_nodes n
      SET 
        tpi = t.tpi,
        tri = t.tri,
        roughness = t.roughness,
        ndwi = t.ndwi,
        bsi = t.bsi,
        lulc_class = t.lulc_class
      FROM temp_landslide_updates t
      WHERE ROUND(n.lat::numeric, 5) = ROUND(t.lat::numeric, 5) 
        AND ROUND(n.lon::numeric, 5) = ROUND(t.lon::numeric, 5)
    `);
    
    console.log(`Bulk update completed! Updated ${result.rowCount} rows.`);

  } catch (err) {
    console.error('Error during bulk update:', err);
  } finally {
    client.release();
    pool.end();
  }
}

main();
