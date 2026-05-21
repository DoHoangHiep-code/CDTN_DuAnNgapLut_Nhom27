const fs = require('fs');
const path = require('path');

const FE_DIR = path.join(__dirname, 'flood-prediction-frontend', 'flood-prediction-system-ui', 'src');

function getAllFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAllFiles(filePath, fileList);
    } else if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const files = getAllFiles(FE_DIR);
const fileNameMap = new Map();
for (const file of files) {
  fileNameMap.set(path.basename(file), file);
}

for (const f of files) {
  let c = fs.readFileSync(f, 'utf8');
  let changed = false;

  const regex = /from\s+['"](\.\.?\/[^'"]+)['"]/g;
  c = c.replace(regex, (match, reqPath) => {
    // If it's importing a CSS file, leave it alone unless it broke
    if (reqPath.endsWith('.css')) return match;

    const absoluteReq = path.resolve(path.dirname(f), reqPath + (reqPath.endsWith('.tsx') || reqPath.endsWith('.ts') ? '' : ''));
    let exists = fs.existsSync(absoluteReq) || fs.existsSync(absoluteReq + '.ts') || fs.existsSync(absoluteReq + '.tsx') || fs.existsSync(path.join(absoluteReq, 'index.tsx')) || fs.existsSync(path.join(absoluteReq, 'index.ts'));

    if (!exists) {
      const basename = path.basename(reqPath);
      let targetAbsolute = fileNameMap.get(basename + '.tsx') || fileNameMap.get(basename + '.ts') || fileNameMap.get(basename);
      
      // Some special cases
      if (basename === 'components') {
          // there are multiple component folders now, we likely mean common
          targetAbsolute = path.join(FE_DIR, 'components/common');
      }

      if (targetAbsolute) {
        let newRel = path.relative(path.dirname(f), targetAbsolute).replace(/\\/g, '/');
        if (!newRel.startsWith('.')) newRel = './' + newRel;
        if (newRel.endsWith('.tsx') || newRel.endsWith('.ts')) {
           // Vite usually doesn't need extensions for TS/TSX
           newRel = newRel.replace(/\.tsx?$/, '');
        }
        changed = true;
        console.log(`[${path.basename(f)}] Fixed ${reqPath} -> ${newRel}`);
        return `from '${newRel}'`;
      }
    }
    return match;
  });

  // Also replace lazy imports: import('./...')
  const regexLazy = /import\(['"](\.\.?\/[^'"]+)['"]\)/g;
  c = c.replace(regexLazy, (match, reqPath) => {
    const absoluteReq = path.resolve(path.dirname(f), reqPath);
    let exists = fs.existsSync(absoluteReq) || fs.existsSync(absoluteReq + '.tsx') || fs.existsSync(path.join(absoluteReq, 'index.tsx'));
    if (!exists) {
      const basename = path.basename(reqPath);
      let targetAbsolute = fileNameMap.get(basename + '.tsx') || fileNameMap.get(basename + '.ts');
      if (targetAbsolute) {
        let newRel = path.relative(path.dirname(f), targetAbsolute).replace(/\\/g, '/');
        if (!newRel.startsWith('.')) newRel = './' + newRel;
        newRel = newRel.replace(/\.tsx?$/, '');
        changed = true;
        console.log(`[${path.basename(f)}] Fixed lazy ${reqPath} -> ${newRel}`);
        return `import('${newRel}')`;
      }
    }
    return match;
  });

  if (changed) {
    fs.writeFileSync(f, c);
  }
}
