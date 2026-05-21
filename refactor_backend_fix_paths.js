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
let anyFixed = false;

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Fix overly-nested relative requires
  const regex = /require\(['"](\.\.\/)+((models|db|common|repositories|services|utils|middlewares|controllers)[^'"]*)['"]\)/g;
  content = content.replace(regex, (match, p1, p2) => {
    // We want to calculate the correct path from 'file' to 'BE_DIR + p2'
    const targetPath = path.join(BE_DIR, p2);
    let relPath = path.relative(path.dirname(file), targetPath).replace(/\\/g, '/');
    if (!relPath.startsWith('.')) {
      relPath = './' + relPath;
    }
    
    // There's a case where p2 is already inside common, e.g. common/middlewares
    // We just trust the relative path generated
    changed = true;
    return `require('${relPath}')`;
  });

  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed paths in', file);
    anyFixed = true;
  }
}

console.log('Done fixing paths. anyFixed:', anyFixed);
