const fs = require('fs');
const path = require('path');

const BE_DIR = path.join(__dirname, 'backend', 'src');

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (filePath.endsWith('.js')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

// Maps old logical paths to new relative paths.
// For simplicity, we just look at the raw require strings and replace them if we know where they went.

const fileMap = {
  // Models and DB stay at root
  '../models': '../../../models',
  '../../models': '../../../models',
  './models': '../models',
  
  '../db/sequelize': '../../../db/sequelize',
  '../../db/sequelize': '../../../db/sequelize',
  
  // Utils
  '../utils/responseHandler': '../../../common/utils/responseHandler',
  '../../utils/responseHandler': '../../../common/utils/responseHandler',
  
  '../utils/mathUtils': '../../../common/utils/mathUtils',
  '../../utils/mathUtils': '../../../common/utils/mathUtils',
  
  // Middlewares
  '../middlewares/auth.middleware': '../../../common/middlewares/auth.middleware',
  '../../middlewares/auth.middleware': '../../../common/middlewares/auth.middleware',
  '../middlewares/optionalAuth.middleware': '../../../common/middlewares/optionalAuth.middleware',
  
  // Services
  '../services/redisClient': '../../../common/services/redisClient',
  '../../services/redisClient': '../../../common/services/redisClient',
  
  '../services/OpenWeatherService': '../../../common/services/OpenWeatherService',
  '../../services/OpenWeatherService': '../../../common/services/OpenWeatherService',

  '../services/PredictionService': '../services/PredictionService',
  '../services/DashboardService': '../services/DashboardService',
  '../services/WeatherService': '../services/WeatherService',
  '../services/ReportsService': '../services/ReportsService',
  '../services/FloodAIService': '../services/FloodAIService',
  '../services/MapService': '../services/MapService',
  '../services/idwInferenceService': '../services/idwInferenceService',
  '../services/floodFeature.service': '../services/floodFeature.service',
  '../services/aiExplain.service': '../services/aiExplain.service',
  
  // Repositories
  '../repositories/DashboardRepository': '../../../repositories/DashboardRepository',
};

const jsFiles = getAllFiles(BE_DIR);

for (const file of jsFiles) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Extremely naive regex for requires, let's just do text replacement for known bad requires if the file is IN modules/flood
  if (file.includes(path.normalize('modules/flood'))) {
    // Replace requires
    content = content.replace(/require\(['"]([^'"]+)['"]\)/g, (match, p1) => {
      if (fileMap[p1]) {
        changed = true;
        return `require('${fileMap[p1]}')`;
      }
      // If it's a relative path that we didn't map, and it goes up to src, we might need to go up one more level
      // Because we moved from src/controllers to src/modules/flood/controllers (1 level deeper)
      if (p1.startsWith('../') && !p1.startsWith('../../')) {
         // It used to go from src/controllers to src/. Now from src/modules/flood/controllers it needs to go to src/
         // Wait, controllers to models: old `../models`, new `../../../models`
      }
      return match;
    });
  }

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated paths in: ${file}`);
  }
}
