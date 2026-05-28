'use strict'

/**
 * Tối ưu hóa: Zoom 18 (lấy Ngõ/Ngách), Chống Rác Dữ Liệu, Cập nhật cả Quận/Huyện và 88 Trạm
 */

require('dotenv').config()
const axios = require('axios')
const { sequelize } = require('../../src/db/sequelize')
const { QueryTypes } = require('sequelize')

const CELL_DEG = 0.004
const DELAY_MS = 1200
const UPDATE_BATCH = 2000
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const BBOX = { minLat: 20.86, maxLat: 21.18, minLon: 105.62, maxLon: 105.95 }

// ─── Hàm lọc rác dữ liệu ─────────────────────────────────────────────────────
function cleanData(text) {
  if (!text) return null;
  text = text.trim();
  // Loại bỏ nếu là số (105.xxx), hoặc quá ngắn, hoặc chứa ký tự lạ
  if (!isNaN(text) || text.match(/^[0-9.]+$/) || text.length < 3) return null;
  return text;
}

const ADMIN_MAP_2025 = require('../../scripts/administrative_mapping_2025.json')

// ─── Bóc tách địa chỉ chi tiết ───────────────────────────────────────────────
function parseAddress(addr) {
  if (!addr) return { locationName: null, districtName: null }

  // Lấy chi tiết Ngõ/Ngách/Đường
  const roadRaw = addr.road || addr.pedestrian || addr.footway || addr.residential || addr.path
  const road = cleanData(roadRaw)

  // Lấy Phường/Xã (Đã cover Xã Thư Lâm, Xã Liên Minh...)
  const wardRaw = addr.quarter || addr.suburb || addr.village || addr.neighbourhood || addr.hamlet
  let ward = cleanData(wardRaw)

  // Lấy Quận/Huyện
  const districtRaw = addr.city_district || addr.county || addr.district || addr.town
  let district = cleanData(districtRaw)

  // BẮT BUỘC chọc vào Mapping Dictionary
  if (ward && ADMIN_MAP_2025[ward]) {
    ward = ADMIN_MAP_2025[ward]
    // Cập nhật cả district_name tương ứng nếu cần (Thường xã lên Phường thì quận cũng đổi hoặc giữ nguyên)
    // Tạm thời nếu mapping có kết quả thì ta cho nó vẫn thuộc district cũ hoặc update district_name
    // VD: Phường Hàng Bạc -> Phường Hoàn Kiếm, District = Quận Hoàn Kiếm
    if (ward.includes('Hoàn Kiếm')) district = 'Quận Hoàn Kiếm'
    else if (ward.includes('Hai Bà Trưng')) district = 'Quận Hai Bà Trưng'
    else if (ward.includes('Đống Đa')) district = 'Quận Đống Đa'
    else if (ward.includes('Ba Đình')) district = 'Quận Ba Đình'
    // .. có thể tự động parse hoặc dựa vào district hiện tại
  }

  let locationName = '';
  if (road && ward && district) locationName = `${road}, ${ward}, ${district}`;
  else if (road && ward) locationName = `${road}, ${ward}`;
  else if (road && district) locationName = `${road}, ${district}`;
  else if (ward && district) locationName = `Khu vực ${ward}, ${district}`;
  else if (ward) locationName = `Khu vực ${ward}`;
  else if (district) locationName = `Khu vực ${district}`;
  else locationName = null;

  return { locationName, districtName: district }
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║   AQUAALERT – ĐẠI TU GEOCODING (Nodes + Stations) - V2       ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  await sequelize.authenticate()

  // SỬA ĐỔI QUAN TRỌNG: Xóa trắng TOÀN BỘ dữ liệu định vị hiện tại để ép chạy lại từ A-Z
  console.log('[Cleanup] Đang xóa toàn bộ dữ liệu Geocoding cũ để làm mới 100%...')
  await sequelize.query(`
    UPDATE grid_nodes SET location_name = NULL, district_name = NULL;
  `)
  await sequelize.query(`
    UPDATE weather_stations SET location_name = NULL;
  `)

  // =====================================================================
  // PHẦN 1: GEOCODING CHO 88 TRẠM (WEATHER STATIONS)
  // =====================================================================
  console.log('\n[Stations] Đang cập nhật 88 Trạm thời tiết...')
  const stations = await sequelize.query(`SELECT id, latitude, longitude FROM weather_stations`, { type: QueryTypes.SELECT })

  for (let i = 0; i < stations.length; i++) {
    try {
      const res = await axios.get(NOMINATIM_URL, {
        params: { lat: stations[i].latitude, lon: stations[i].longitude, format: 'json', zoom: 18, addressdetails: 1 },
        headers: { 'User-Agent': 'AQUAALERT-Geocoder/3.0' }
      })
      const parsed = parseAddress(res.data?.address)
      if (parsed.locationName) {
        await sequelize.query(`UPDATE weather_stations SET location_name = '${parsed.locationName.replace(/'/g, "''")}' WHERE id = '${stations[i].id}'`)
      }
    } catch (e) { }
    process.stdout.write(`\r  └ Tiến độ trạm: ${i + 1}/${stations.length}`)
    await sleep(DELAY_MS)
  }

  // =====================================================================
  // PHẦN 2: GEOCODING CHO GRID NODES (Chia lưới 0.44km)
  // =====================================================================
  console.log('\n\n[Nodes] Đang tải 53K nodes...')
  // Bỏ điều kiện WHERE vì ta đã xóa trắng ở bước Cleanup, giờ select ALL
  const nodes = await sequelize.query(`SELECT node_id, latitude, longitude FROM grid_nodes`, { type: QueryTypes.SELECT })

  if (!nodes.length) {
    console.log('✅ Lỗi: Không tìm thấy nodes nào trong Database!')
    return
  }

  const cellMap = new Map()
  for (const n of nodes) {
    const r = Math.floor((parseFloat(n.latitude) - BBOX.minLat) / CELL_DEG)
    const c = Math.floor((parseFloat(n.longitude) - BBOX.minLon) / CELL_DEG)
    const key = `${r}_${c}`
    if (!cellMap.has(key)) cellMap.set(key, { centLat: BBOX.minLat + (r + 0.5) * CELL_DEG, centLon: BBOX.minLon + (c + 0.5) * CELL_DEG, nodeIds: [] })
    cellMap.get(key).nodeIds.push(String(n.node_id))
  }

  console.log(`[Nodes] Đã tạo lưới: Cần gọi ${cellMap.size} ô lưới...`)
  const nameMap = new Map()
  let cellDone = 0

  for (const [key, cell] of cellMap.entries()) {
    try {
      const res = await axios.get(NOMINATIM_URL, {
        params: { lat: cell.centLat, lon: cell.centLon, format: 'json', zoom: 18, addressdetails: 1 },
        headers: { 'User-Agent': 'AQUAALERT-Geocoder/3.0' },
        timeout: 8000,
      })
      const parsed = parseAddress(res.data?.address)

      const locName = parsed.locationName || `Khu vực ${cell.centLat.toFixed(3)}, ${cell.centLon.toFixed(3)}`
      const distName = parsed.districtName || 'Hà Nội'

      for (const nid of cell.nodeIds) nameMap.set(nid, { loc: locName, dist: distName })
    } catch {
      for (const nid of cell.nodeIds) nameMap.set(nid, { loc: `Khu vực ${cell.centLat.toFixed(3)}, ${cell.centLon.toFixed(3)}`, dist: 'Hà Nội' })
    }

    cellDone++
    process.stdout.write(`\r  Tiến độ: ${cellDone}/${cellMap.size} ô`)
    await sleep(DELAY_MS)

    if (cellDone % 200 === 0 || cellDone === cellMap.size) {
      if (nameMap.size > 0) {
        const entries = [...nameMap.entries()]
        for (let i = 0; i < entries.length; i += UPDATE_BATCH) {
          const chunk = entries.slice(i, i + UPDATE_BATCH)
          const values = chunk.map(([id, data]) =>
            `('${id}', '${data.loc.replace(/'/g, "''")}', '${data.dist.replace(/'/g, "''")}')`
          ).join(',\n')

          await sequelize.query(`
            UPDATE grid_nodes AS gn
            SET location_name = v.loc, district_name = v.dist
            FROM (VALUES ${values}) AS v(node_id, loc, dist)
            WHERE gn.node_id::text = v.node_id;
          `)
        }
        nameMap.clear()
      }
    }
  }

  console.log('\n✅ Xong! Database đã được Geocode lại 100% từ đầu!')
}

main().catch(e => console.error('❌', e.message)).finally(() => sequelize.close())
