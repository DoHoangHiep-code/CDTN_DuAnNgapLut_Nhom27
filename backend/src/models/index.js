const { sequelize } = require('../db/sequelize')

const User = require('./User')(sequelize)
const GridNode = require('./GridNode')(sequelize)
const WeatherMeasurement = require('./WeatherMeasurement')(sequelize)
const FloodPrediction = require('./FloodPrediction')(sequelize)
const ActualFloodReport = require('./ActualFloodReport')(sequelize)
const SystemLog = require('./SystemLog')(sequelize)

// Associations (explicit 1-to-N)
GridNode.hasMany(WeatherMeasurement, { foreignKey: 'node_id', sourceKey: 'node_id' })
WeatherMeasurement.belongsTo(GridNode, { foreignKey: 'node_id', targetKey: 'node_id' })

GridNode.hasMany(FloodPrediction, { foreignKey: 'node_id', sourceKey: 'node_id' })
FloodPrediction.belongsTo(GridNode, { foreignKey: 'node_id', targetKey: 'node_id' })

User.hasMany(ActualFloodReport, { foreignKey: 'user_id', sourceKey: 'user_id' })
ActualFloodReport.belongsTo(User, { foreignKey: 'user_id', targetKey: 'user_id' })

User.hasMany(SystemLog, { foreignKey: 'admin_id', sourceKey: 'user_id' })
SystemLog.belongsTo(User, { foreignKey: 'admin_id', targetKey: 'user_id' })

module.exports = {
  sequelize,
  User,
  GridNode,
  WeatherMeasurement,
  FloodPrediction,
  ActualFloodReport,
  SystemLog,
}

