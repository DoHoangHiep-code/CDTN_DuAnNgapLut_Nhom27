require('dotenv').config()
const { sequelize } = require('./src/db/sequelize')
const { QueryTypes } = require('sequelize')

/**
 * fix_location_sync.js
 * 1. Sync location_name từ grid_nodes → weather_measurements + flood_predictions
 * 2. Cập nhật district_name từ location_name (lấy phần sau dấu phẩy)
 */
async function main() {
  console.log('\n[Fix] Bắt đầu đồng bộ location_name và district_name...\n')

  // ── 1. Sync location_name: weather_measurements ← grid_nodes ──────────────
  console.log('[1/3] Sync location_name vào weather_measurements...')
  const [wmResult] = await sequelize.query(`
    UPDATE weather_measurements wm
    SET location_name = gn.location_name
    FROM grid_nodes gn
    WHERE wm.node_id = gn.node_id
      AND gn.location_name IS NOT NULL
      AND gn.location_name NOT LIKE 'Grid_%';
  `)
  console.log('  ✅ weather_measurements đã cập nhật location_name.')

  // ── 2. Sync location_name: flood_predictions ← grid_nodes ─────────────────
  console.log('[2/3] Sync location_name vào flood_predictions...')
  const [fpResult] = await sequelize.query(`
    UPDATE flood_predictions fp
    SET location_name = gn.location_name
    FROM grid_nodes gn
    WHERE fp.node_id = gn.node_id
      AND gn.location_name IS NOT NULL
      AND gn.location_name NOT LIKE 'Grid_%';
  `)
  console.log('  ✅ flood_predictions đã cập nhật location_name.')

  // ── 3. Cập nhật district_name trong grid_nodes ─────────────────────────────
  // district_name = phần sau dấu phẩy cuối cùng của location_name
  // VD: "Phường Yên Nghĩa, Thành phố Hà Nội" → "Thành phố Hà Nội"
  // VD: "Xã Nam Phù" → "Xã Nam Phù" (không có dấu phẩy → giữ nguyên)
  console.log('[3/3] Cập nhật district_name từ location_name...')
  await sequelize.query(`
    UPDATE grid_nodes
    SET district_name = CASE
      WHEN location_name LIKE '%,%'
        THEN TRIM(SPLIT_PART(location_name, ',', 2))
      WHEN location_name IS NOT NULL AND location_name NOT LIKE 'Grid_%'
        THEN TRIM(location_name)
      ELSE NULL
    END
    WHERE location_name IS NOT NULL AND location_name NOT LIKE 'Grid_%';
  `)
  console.log('  ✅ district_name đã cập nhật.')

  // ── Kiểm tra kết quả ───────────────────────────────────────────────────────
  const stats = await sequelize.query(`
    SELECT
      (SELECT COUNT(*) FROM grid_nodes WHERE district_name IS NOT NULL) AS gn_district,
      (SELECT COUNT(*) FROM grid_nodes WHERE location_name NOT LIKE 'Grid_%' AND location_name IS NOT NULL) AS gn_named,
      (SELECT COUNT(*) FROM weather_measurements WHERE location_name NOT LIKE 'Grid_%' AND location_name IS NOT NULL) AS wm_named,
      (SELECT COUNT(*) FROM flood_predictions WHERE location_name IS NOT NULL) AS fp_named;
  `, { type: QueryTypes.SELECT })

  const s = stats[0]
  console.log('\n=== KẾT QUẢ ===')
  console.log('grid_nodes     – named:', s.gn_named, '| district_name:', s.gn_district)
  console.log('weather_meas   – named:', s.wm_named)
  console.log('flood_pred     – named:', s.fp_named)

  // Sample district_name
  const sample = await sequelize.query(
    "SELECT district_name, COUNT(*) cnt FROM grid_nodes WHERE district_name IS NOT NULL GROUP BY district_name ORDER BY cnt DESC LIMIT 8;",
    { type: QueryTypes.SELECT }
  )
  console.log('\nTop districts:')
  sample.forEach(r => console.log('  ' + r.district_name + ' – ' + r.cnt + ' nodes'))

  await sequelize.close()
  console.log('\n✅ Xong!')
}

main().catch(e => { console.error('ERR:', e.message); process.exit(1) })
