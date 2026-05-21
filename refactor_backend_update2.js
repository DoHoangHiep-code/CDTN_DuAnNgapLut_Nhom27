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

const jsFiles = getAllFiles(BE_DIR);

function adjustPath(oldRequire, filePath) {
  // We only adjust paths starting with '.'
  if (!oldRequire.startsWith('.')) return oldRequire;

  const isFloodModule = filePath.includes(path.normalize('modules/flood'));
  const isCommonModule = filePath.includes(path.normalize('common'));
  
  if (isFloodModule) {
    // If it requires something in models, db, repositories, it needs to go up 2 more levels
    if (oldRequire.includes('models') || oldRequire.includes('db') || oldRequire.includes('repositories')) {
      return oldRequire.replace('../', '../../../').replace('../../', '../../../../');
    }
    // If it requires middlewares, utils, redisClient, OpenWeatherService, backupCron, it goes to common
    if (oldRequire.includes('middlewares') || oldRequire.includes('utils')) {
      let replaced = oldRequire.replace('../', '../../../common/').replace('../../', '../../../../common/');
      return replaced;
    }
    if (oldRequire.includes('redisClient') || oldRequire.includes('OpenWeatherService') || oldRequire.includes('backupCron')) {
       // it used to be ../services/redisClient
       return oldRequire.replace('../services/', '../../../common/services/').replace('../../services/', '../../../../common/services/');
    }
  }

  if (isCommonModule) {
    // if something in common requires models/db
    // old from src/middlewares: ../models
    // new from src/common/middlewares: ../../models
    if (oldRequire.includes('models') || oldRequire.includes('db') || oldRequire.includes('repositories')) {
      return oldRequire.replace('../', '../../').replace('../../', '../../../');
    }
    if (oldRequire.includes('utils')) {
      // old from src/middlewares: ../utils/x
      // new from src/common/middlewares: ../utils/x  (stays same)
      return oldRequire;
    }
  }
  
  // controllers/server.js requires
  if (filePath.endsWith('server.js')) {
    // server.js at src/
    if (oldRequire.includes('routes/flood') || oldRequire.includes('routes/dashboard') || oldRequire.includes('routes/map') || oldRequire.includes('routes/reports') || oldRequire.includes('routes/weather') || oldRequire.includes('routes/alerts')) {
       return oldRequire.replace('./routes/', './modules/flood/routes/');
    }
    if (oldRequire.includes('services/weatherCron') || oldRequire.includes('services/floodPredictionCron')) {
       return oldRequire.replace('./services/', './modules/flood/cron/');
    }
    if (oldRequire.includes('services/backupCron')) {
       return oldRequire.replace('./services/', './common/services/');
    }
    if (oldRequire.includes('middlewares/')) {
       return oldRequire.replace('./middlewares/', './common/middlewares/');
    }
  }

  return oldRequire;
}

for (const file of jsFiles) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  content = content.replace(/require\(['"]([^'"]+)['"]\)/g, (match, p1) => {
    const newPath = adjustPath(p1, file);
    if (newPath !== p1) {
      changed = true;
      return `require('${newPath}')`;
    }
    return match;
  });

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Adjusted paths in: ${file}`);
  }
}
