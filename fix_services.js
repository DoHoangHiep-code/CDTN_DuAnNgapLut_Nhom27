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
  let c = fs.readFileSync(f, 'utf8');
  let changed = false;

  // Since routes are in src/modules/flood/routes
  // and services are in src/modules/flood/services
  // the relative path should be ../services
  // but it might have been incorrectly replaced to ../../../services
  // Wait, let's fix ANY require that goes to `../../../services` and replace it with `../services`
  // if it's in a flood module file. But wait, `../../../common/services/` is correct for OpenWeatherService.
  // We only replace `../../../services` with `../services`
  
  if (f.includes(path.normalize('modules/flood'))) {
    const replacer = (regex, replacement) => {
      if (regex.test(c)) {
        c = c.replace(regex, replacement);
        changed = true;
      }
    };
    
    // Fix `../../../services/DashboardService` etc.
    replacer(/require\(['"]\.\.\/\.\.\/\.\.\/services/g, "require('../services");
    replacer(/require\(['"]\.\.\/\.\.\/\.\.\/\.\.\/services/g, "require('../services"); // just in case
    
    // Fix controllers: `../../../controllers/` to `../controllers/` (from routes)
    replacer(/require\(['"]\.\.\/\.\.\/\.\.\/controllers/g, "require('../controllers");
    
    if (changed) {
      fs.writeFileSync(f, c);
      console.log("Fixed in", f);
    }
  }
}
