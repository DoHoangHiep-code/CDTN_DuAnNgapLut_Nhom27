const express = require('express')
const { sequelize } = require('../db/sequelize')
const { MapRepository } = require('../repositories/MapRepository')
const { MapService } = require('../services/MapService')
const { MapController } = require('../controllers/MapController')

const router = express.Router()

const mapRepository = new MapRepository({ sequelize })
const mapService = new MapService({ mapRepository })
const mapController = new MapController({ mapService })

router.get('/flood-maps', mapController.getFloodMaps)

module.exports = { mapRouter: router }

