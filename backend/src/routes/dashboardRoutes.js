const express = require('express')
const { sequelize } = require('../db/sequelize')
const { DashboardRepository } = require('../repositories/DashboardRepository')
const { DashboardService } = require('../services/DashboardService')
const { DashboardController } = require('../controllers/DashboardController')

const router = express.Router()

const dashboardRepository = new DashboardRepository({ sequelize })
const dashboardService = new DashboardService({ dashboardRepository })
const dashboardController = new DashboardController({ dashboardService })

router.get('/dashboard', dashboardController.getDashboard)

module.exports = { dashboardRouter: router }

