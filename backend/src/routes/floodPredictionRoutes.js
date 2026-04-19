'use strict'

const express = require('express')
const { sequelize } = require('../db/sequelize')
const { WeatherRepository } = require('../repositories/WeatherRepository')
const { PredictionService } = require('../services/PredictionService')
const { FloodPredictionController } = require('../controllers/FloodPredictionController')

const router = express.Router()

const weatherRepository = new WeatherRepository({ sequelize })
const predictionService = new PredictionService({ weatherRepository, sequelize })
const controller = new FloodPredictionController({ predictionService })

router.get('/flood-prediction', controller.getFloodPrediction)
router.post('/flood-prediction/run', controller.triggerBatch)

module.exports = { floodPredictionRouter: router }
