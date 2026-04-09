const express = require('express')
const { sequelize } = require('../db/sequelize')
const { WeatherRepository } = require('../repositories/WeatherRepository')
const { WeatherService } = require('../services/WeatherService')
const { WeatherController } = require('../controllers/WeatherController')

const router = express.Router()

const weatherRepository = new WeatherRepository({ sequelize })
const weatherService = new WeatherService({ weatherRepository })
const weatherController = new WeatherController({ weatherService })

router.get('/weather', weatherController.getWeather)

module.exports = { weatherRouter: router }

