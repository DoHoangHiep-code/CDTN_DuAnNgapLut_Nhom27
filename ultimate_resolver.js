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
const fileNameMap = new Map();
// map filename -> absolute path
for (const file of files) {
  fileNameMap.set(path.basename(file), file);
}

// Some files might have same name like index.js, but most don't.
// Let's resolve requires manually for broken ones.
for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  let changed = false;

  const regex = /require\(['"](\.\.?\/[^'"]+)['"]\)/g;
  c = c.replace(regex, (match, reqPath) => {
    const absoluteReq = path.resolve(path.dirname(f), reqPath + (reqPath.endsWith('.js') ? '' : '.js'));
    let exists = fs.existsSync(absoluteReq);
    if (!exists && fs.existsSync(absoluteReq.replace(/\.js$/, ''))) { // maybe it's a directory like models
       exists = true; 
    }
    if (!exists && fs.existsSync(path.resolve(path.dirname(f), reqPath, 'index.js'))) {
       exists = true;
    }

    if (!exists) {
      // It's broken! Let's find by basename
      const basename = path.basename(reqPath);
      let targetAbsolute = fileNameMap.get(basename + '.js') || fileNameMap.get(basename);
      
      // Special cases for directories
      if (basename === 'models') targetAbsolute = path.join(BE_DIR, 'models');
      if (basename === 'db') targetAbsolute = path.join(BE_DIR, 'db');
      if (basename === 'sequelize') targetAbsolute = path.join(BE_DIR, 'db', 'sequelize.js');

      if (targetAbsolute) {
        let newRel = path.relative(path.dirname(f), targetAbsolute).replace(/\\/g, '/');
        if (!newRel.startsWith('.')) newRel = './' + newRel;
        if (newRel.endsWith('.js')) newRel = newRel.slice(0, -3); // remove .js
        changed = true;
        console.log(`[${path.basename(f)}] Fixed ${reqPath} -> ${newRel}`);
        return `require('${newRel}')`;
      } else {
        console.log(`[${path.basename(f)}] Could not fix ${reqPath}`);
      }
    }
    return match;
  });

  if (changed) {
    fs.writeFileSync(f, c);
  }
}
