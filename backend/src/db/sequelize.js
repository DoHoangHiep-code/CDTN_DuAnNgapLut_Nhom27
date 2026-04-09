const { Sequelize } = require('sequelize')
const config = require('./config')

const env = process.env.NODE_ENV || 'development'
const cfg = config[env]

const sequelize = new Sequelize(cfg.database, cfg.username, cfg.password, cfg)

module.exports = { sequelize }

