const fs = require('fs');
const path = require('path');

const FE_DIR = path.join(__dirname, 'flood-prediction-frontend', 'flood-prediction-system-ui', 'src');

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
ensureDir(path.join(FE_DIR, 'features/flood/pages'));
ensureDir(path.join(FE_DIR, 'features/flood/components'));
ensureDir(path.join(FE_DIR, 'features/landslide/pages'));
ensureDir(path.join(FE_DIR, 'features/landslide/components'));
ensureDir(path.join(FE_DIR, 'components/common'));

// 2. Move Common Components
const commonMoves = [
  'Badge.tsx', 'Badge3D.tsx', 'Button.tsx', 'Card.tsx', 
  'ErrorBoundary.tsx', 'ErrorState.tsx', 'GlassCard.tsx', 'Input.tsx', 
  'NewsTicker.tsx', 'ProtectedRoute.tsx', 'Spinner.tsx', 
  'Title3D.tsx', 'Toggle.tsx', 'ChatInterface.tsx', 'ExpertChatbot.tsx', 'FloatingChatBotIcon.tsx'
];

commonMoves.forEach(file => {
  moveFile(path.join(FE_DIR, `components/${file}`), path.join(FE_DIR, `components/common/${file}`));
});

// 3. Move Flood Components
const floodComponents = [
  'FloodReportModal.tsx', 'FloodWarningCard.tsx', 
  'LocationSearch.tsx', 'MiniFloodMap.tsx', 'RainChart.tsx'
];

floodComponents.forEach(file => {
  moveFile(path.join(FE_DIR, `components/${file}`), path.join(FE_DIR, `features/flood/components/${file}`));
});

// 4. Move Flood Pages
const floodPages = [
  'MapPage.tsx', 'ReportsPage.tsx', 'WeatherPage.tsx'
];

floodPages.forEach(file => {
  moveFile(path.join(FE_DIR, `pages/${file}`), path.join(FE_DIR, `features/flood/pages/${file}`));
});

// For Dashboard (it's a directory)
moveFile(path.join(FE_DIR, 'pages/Dashboard'), path.join(FE_DIR, 'features/flood/pages/Dashboard'));

// 5. Create HazardSwitcher
const hazardSwitcherCode = `import React from 'react';
export function HazardSwitcher() {
  return (
    <div className="flex gap-2 bg-slate-800 p-1 rounded-lg">
      <button className="px-4 py-2 bg-blue-600 text-white rounded-md">Ngập Lụt</button>
      <button className="px-4 py-2 text-slate-400 hover:text-white rounded-md">Sạt Lở</button>
    </div>
  );
}`;
fs.writeFileSync(path.join(FE_DIR, 'components/common/HazardSwitcher.tsx'), hazardSwitcherCode);

// 6. Create Landslide Skeleton Pages
const landslideMapCode = `import React from 'react';
export function LandslideMapPage() {
  return <div className="p-4 text-white">Bản đồ Sạt Lở (Đang phát triển)</div>;
}`;
fs.writeFileSync(path.join(FE_DIR, 'features/landslide/pages/LandslideMapPage.tsx'), landslideMapCode);

const landslideDashCode = `import React from 'react';
export function LandslideDashboardPage() {
  return <div className="p-4 text-white">Tổng quan Sạt Lở (Đang phát triển)</div>;
}`;
fs.writeFileSync(path.join(FE_DIR, 'features/landslide/pages/LandslideDashboardPage.tsx'), landslideDashCode);

console.log('Frontend moving completed.');
