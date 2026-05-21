'use strict'

const { sequelize } = require('../src/db/sequelize')
const { QueryTypes } = require('sequelize')
const ADMIN_MAP_2025 = require('./administrative_mapping_2025.json')

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║        MIGRATE DATA HÀNH CHÍNH 2025 - AQUAALERT              ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  
  await sequelize.authenticate()
  
  console.log('[Data Cleansing] Bắt đầu quét bảng grid_nodes...')
  
  const nodes = await sequelize.query('SELECT node_id, location_name, district_name FROM grid_nodes WHERE location_name IS NOT NULL', { type: QueryTypes.SELECT })
  
  let changed = 0
  const updates = []
  
  for (const node of nodes) {
    let locName = node.location_name
    let distName = node.district_name
    let modified = false
    
    // Tách các thành phần của location_name (ngăn cách bởi dấu phẩy)
    const parts = locName.split(',').map(p => p.trim())
    
    for (let i = 0; i < parts.length; i++) {
      if (ADMIN_MAP_2025[parts[i]]) {
        parts[i] = ADMIN_MAP_2025[parts[i]]
        modified = true
      }
    }
    
    if (modified) {
      locName = parts.join(', ')
      // Cập nhật lại district_name nếu phường mapping thuộc quận lõi (heuristic cơ bản)
      for (const p of parts) {
        if (p.includes('Hoàn Kiếm')) distName = 'Quận Hoàn Kiếm'
        else if (p.includes('Hai Bà Trưng')) distName = 'Quận Hai Bà Trưng'
        else if (p.includes('Đống Đa')) distName = 'Quận Đống Đa'
        else if (p.includes('Ba Đình')) distName = 'Quận Ba Đình'
      }
      
      updates.push(`('${node.node_id}', '${locName.replace(/'/g, "''")}', '${distName ? distName.replace(/'/g, "''") : ''}')`)
      console.log(`[Migrate] Node ${node.node_id}: ${node.location_name} -> ${locName} (${distName})`)
      changed++
    }
  }

  if (updates.length > 0) {
    console.log(`\n[Data Cleansing] Đã phát hiện ${changed} bản ghi cần cập nhật. Đang thực thi...`)
    
    // Batch update mỗi 2000 records
    const BATCH_SIZE = 2000
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const chunk = updates.slice(i, i + BATCH_SIZE)
      await sequelize.query(`
        UPDATE grid_nodes AS gn
        SET location_name = v.loc, district_name = v.dist
        FROM (VALUES ${chunk.join(',\n')}) AS v(node_id, loc, dist)
        WHERE gn.node_id::text = v.node_id;
      `)
    }
    console.log(`[Data Cleansing] Hoàn tất! Đã cập nhật thành công ${changed} nodes.`)
  } else {
    console.log('[Data Cleansing] Dữ liệu đã chuẩn hóa, không có node nào cần cập nhật.')
  }
}

main().catch(e => console.error('❌', e.message)).finally(() => sequelize.close())
