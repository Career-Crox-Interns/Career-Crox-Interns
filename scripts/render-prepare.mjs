import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const root = process.cwd();
const frontendDir = path.join(root, 'frontend');
const packedFrontendZip = path.join(root, 'frontend-source.zip');
const packedFrontendTar = path.join(root, 'frontend-source.tar.gz');

if (!fs.existsSync(frontendDir) && fs.existsSync(packedFrontendZip)) {
  console.log('Unpacking packed frontend source from ZIP...');
  execSync('unzip -q frontend-source.zip', { stdio: 'inherit' });
}

if (!fs.existsSync(frontendDir) && fs.existsSync(packedFrontendTar)) {
  console.log('Unpacking packed frontend source from TAR...');
  execSync('tar -xzf frontend-source.tar.gz', { stdio: 'inherit' });
}

if (!fs.existsSync(frontendDir)) {
  console.error('Frontend source folder missing. Expected frontend/, frontend-source.zip, or frontend-source.tar.gz.');
  process.exit(1);
}

console.log('Building current frontend source for deployment...');
execSync('cd frontend && npm ci --registry=https://registry.npmjs.org/ && node ./node_modules/vite/bin/vite.js build', { stdio: 'inherit' });
execSync('node scripts/copy-spa.mjs', { stdio: 'inherit' });
