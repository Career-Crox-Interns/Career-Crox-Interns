import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const siblingFrontend = path.resolve(root, '../frontend');
const localFrontend = path.join(root, 'frontend');
const frontendDir = fs.existsSync(path.join(siblingFrontend, 'package.json')) ? siblingFrontend : localFrontend;
if (!fs.existsSync(path.join(frontendDir, 'package.json'))) {
  console.error('Frontend source folder missing. Expected ../frontend or frontend.');
  process.exit(1);
}
console.log('Building frontend source for deployment...');
execSync('npm ci --registry=https://registry.npmjs.org/ && node ./node_modules/vite/bin/vite.js build', { cwd: frontendDir, stdio: 'inherit' });
const dist = path.join(frontendDir, 'dist');
const target = path.join(root, 'public', 'spa');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(dist, target, { recursive: true });
console.log('SPA copied to backend/public/spa');
