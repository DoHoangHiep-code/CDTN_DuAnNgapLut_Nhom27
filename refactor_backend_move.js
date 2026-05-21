const fs = require('fs');
const path = require('path');

const BE_DIR = path.join(__dirname, 'backend', 'src');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function moveFile(src, dest) {
  if (fs.existsSync(src)) {
    ensureDir(path.dirname(dest));
    fs.renameSync(src, dest);
    console.log(`Moved: ${src} -> ${dest}`);
  }
}

// 1. Create directories
ensureDir(path.join(BE_DIR, 'modules/flood/controllers'));
ensureDir(path.join(BE_DIR, 'modules/flood/services'));
ensureDir(path.join(BE_DIR, 'modules/flood/routes'));
ensureDir(path.join(BE_DIR, 'modules/flood/cron'));

ensureDir(path.join(BE_DIR, 'modules/landslide/controllers'));
ensureDir(path.join(BE_DIR, 'modules/landslide/services'));
ensureDir(path.join(BE_DIR, 'modules/landslide/routes'));
ensureDir(path.join(BE_DIR, 'modules/landslide/cron'));

ensureDir(path.join(BE_DIR, 'common/middlewares'));
ensureDir(path.join(BE_DIR, 'common/utils'));
ensureDir(path.join(BE_DIR, 'common/services'));

// 2. Move Common
const commonMoves = [
  // Middlewares
  ['middlewares/auth.middleware.js', 'common/middlewares/auth.middleware.js'],
  ['middlewares/optionalAuth.middleware.js', 'common/middlewares/optionalAuth.middleware.js'],
  ['middlewares/upload.middleware.js', 'common/middlewares/upload.middleware.js'], // if exists
  // Utils
  ['utils/authUtils.js', 'common/utils/authUtils.js'],
  ['utils/dateUtils.js', 'common/utils/dateUtils.js'],
  ['utils/mathUtils.js', 'common/utils/mathUtils.js'],
  ['utils/responseHandler.js', 'common/utils/responseHandler.js'],
  // Services (Shared)
  ['services/redisClient.js', 'common/services/redisClient.js'],
  ['services/backupCron.js', 'common/services/backupCron.js'],
  ['services/OpenWeatherService.js', 'common/services/OpenWeatherService.js']
];

// 3. Move Flood
const floodMoves = [
  // Controllers
  ['controllers/FloodPredictionController.js', 'modules/flood/controllers/FloodPredictionController.js'],
  ['controllers/MapController.js', 'modules/flood/controllers/MapController.js'],
  ['controllers/ReportsController.js', 'modules/flood/controllers/ReportsController.js'],
  ['controllers/DashboardController.js', 'modules/flood/controllers/DashboardController.js'],
  ['controllers/WeatherController.js', 'modules/flood/controllers/WeatherController.js'],
  // Services
  ['services/FloodAIService.js', 'modules/flood/services/FloodAIService.js'],
  ['services/PredictionService.js', 'modules/flood/services/PredictionService.js'],
  ['services/MapService.js', 'modules/flood/services/MapService.js'],
  ['services/ReportsService.js', 'modules/flood/services/ReportsService.js'],
  ['services/DashboardService.js', 'modules/flood/services/DashboardService.js'],
  ['services/WeatherService.js', 'modules/flood/services/WeatherService.js'],
  ['services/idwInferenceService.js', 'modules/flood/services/idwInferenceService.js'],
  ['services/floodFeature.service.js', 'modules/flood/services/floodFeature.service.js'],
  ['services/aiExplain.service.js', 'modules/flood/services/aiExplain.service.js'],
  // Cron
  ['services/floodPredictionCron.js', 'modules/flood/cron/floodPredictionCron.js'],
  ['services/weatherCron.js', 'modules/flood/cron/weatherCron.js'],
  // Routes
  ['routes/floodPredictionRoutes.js', 'modules/flood/routes/floodPredictionRoutes.js'],
  ['routes/dashboardRoutes.js', 'modules/flood/routes/dashboardRoutes.js'],
  ['routes/mapRoutes.js', 'modules/flood/routes/mapRoutes.js'],
  ['routes/reportsRoutes.js', 'modules/flood/routes/reportsRoutes.js'],
  ['routes/weatherRoutes.js', 'modules/flood/routes/weatherRoutes.js'],
  ['routes/alertsRoutes.js', 'modules/flood/routes/alertsRoutes.js'],
];

[...commonMoves, ...floodMoves].forEach(([src, dest]) => {
  moveFile(path.join(BE_DIR, src), path.join(BE_DIR, dest));
});

console.log("File moving completed.");
