import fs from 'fs';
import path from 'path';

const root = process.cwd();
const from = path.join(root, 'frontend', 'dist');
const to = path.join(root, 'backend', 'public', 'spa');

if (!fs.existsSync(from)) {
  console.error('Frontend build not found at frontend/dist');
  process.exit(1);
}

fs.rmSync(to, { recursive: true, force: true });
fs.mkdirSync(to, { recursive: true });
fs.cpSync(from, to, { recursive: true });
console.log('SPA copied to backend/public/spa');
