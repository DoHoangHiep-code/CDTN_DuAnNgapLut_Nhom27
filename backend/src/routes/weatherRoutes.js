const express = require('express')
const { sequelize } = require('../db/sequelize')
const { WeatherRepository } = require('../repositories/WeatherRepository')
const { WeatherService } = require('../services/WeatherService')
const { WeatherController } = require('../controllers/WeatherController')
const { getWeatherByCoords } = require('../services/OpenWeatherService')

const router = express.Router()

const weatherRepository = new WeatherRepository({ sequelize })
const weatherService = new WeatherService({ weatherRepository })
const weatherController = new WeatherController({ weatherService })

// Route cũ: lấy thời tiết từ DB nội bộ theo district/lat/lng
router.get('/weather', weatherController.getWeather)

// Route mới: lấy thời tiết THỰC TẾ từ OpenWeatherMap API theo tọa độ
// GET /api/v1/weather/live?lat=21.02&lon=105.83
router.get('/weather/live', async (req, res, next) => {
  try {
    const lat = Number(req.query.lat)
    const lon = Number(req.query.lon)

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.status(400).json({
        success: false,
        error: { message: 'Tham số lat và lon phải là số thực hợp lệ.' },
      })
    }

    const data = await getWeatherByCoords(lat, lon)

    if (!data) {
      return res.status(503).json({
        success: false,
        error: {
          message: 'Không thể lấy dữ liệu thời tiết. Kiểm tra OPENWEATHER_API_KEY trong .env.',
        },
      })
    }

    return res.status(200).json({ success: true, data })
  } catch (err) {
    return next(err)
  }
})

module.exports = { weatherRouter: router }

