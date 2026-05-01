const { sequelize } = require('./src/db/sequelize');

async function cleanGridNodes() {
  try {
    // Tắt read_only (đề phòng Aiven vẫn còn cache read_only transaction)
    await sequelize.query('SET default_transaction_read_only = off;');
    
    // Xóa 53,291 điểm CSV, chỉ giữ lại 39 điểm ngập
    const [results, metadata] = await sequelize.query('DELETE FROM grid_nodes WHERE node_id < 200000;');
    console.log('DELETE_SUCCESS: Đã xóa các điểm lưới ảo. Số dòng bị xóa:', metadata.rowCount);
    
    // Kiểm tra số lượng còn lại
    const [countRes] = await sequelize.query('SELECT COUNT(*) as count FROM grid_nodes;');
    console.log('Số điểm ngập còn lại trong DB:', countRes[0].count);
  } catch (err) {
    console.error('DELETE_FAILED:', err.message);
  } finally {
    process.exit();
  }
}

cleanGridNodes();
