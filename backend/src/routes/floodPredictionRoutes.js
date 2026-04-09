const express = require('express') // Import express
const { FloodPredictionController } = require('../controllers/FloodPredictionController') // Controller compat

const router = express.Router() // Router
const controller = new FloodPredictionController() // Controller không cần deps

// Endpoint compat: GET /api/v1/flood-prediction
router.get('/flood-prediction', controller.getFloodPrediction)

module.exports = { floodPredictionRouter: router }

