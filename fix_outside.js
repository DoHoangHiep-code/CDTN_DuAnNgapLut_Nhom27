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

const files = getAllFiles(BE_DIR);

for (const f of files) {
  // only care about files outside of 'modules' and 'common'
  if (!f.includes(path.normalize('modules')) && !f.includes(path.normalize('common'))) {
    let c = fs.readFileSync(f, 'utf8');
    let changed = false;

    const replacer = (regex, replacement) => {
      if (regex.test(c)) {
        c = c.replace(regex, replacement);
        changed = true;
      }
    };
    
    // They are in src/routes, src/controllers, src/services
    // Their old require for middlewares was '../middlewares/X'
    // Now it should be '../common/middlewares/X'
    replacer(/require\(['"]\.\.\/middlewares\//g, "require('../common/middlewares/");
    
    // Same for utils
    replacer(/require\(['"]\.\.\/utils\//g, "require('../common/utils/");
    
    // For services/redisClient and services/OpenWeatherService
    // from src/controllers or src/routes
    replacer(/require\(['"]\.\.\/services\/redisClient['"]\)/g, "require('../common/services/redisClient')");
    replacer(/require\(['"]\.\.\/services\/OpenWeatherService['"]\)/g, "require('../common/services/OpenWeatherService')");
    
    if (changed) {
      fs.writeFileSync(f, c);
      console.log("Fixed outside module in", f);
    }
  }
}
