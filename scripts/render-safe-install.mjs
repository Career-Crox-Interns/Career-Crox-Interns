import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const target = process.argv[2] || 'backend';
const root = process.cwd();
const dir = path.join(root, target);
if (!['frontend','backend'].includes(target)) throw new Error('Invalid dependency target');
if (!fs.existsSync(dir)) { console.error(`Missing folder: ${target}`); process.exit(1); }

const pkgPath = path.join(dir, 'package.json');
const lockPath = fs.existsSync(path.join(dir, 'package-lock.json')) ? path.join(dir, 'package-lock.json') : '';
const nodeModules = path.join(dir, 'node_modules');
const marker = path.join(nodeModules, '.career-crox-deps.sha256');
const hash = crypto.createHash('sha256')
  .update(fs.readFileSync(pkgPath))
  .update(lockPath ? fs.readFileSync(lockPath) : Buffer.from('no-lock'))
  .digest('hex');

function depsReady() {
  try {
    if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== hash) return false;
    const req = createRequire(pkgPath);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = Object.keys(pkg.dependencies || {});
    if (target === 'frontend') deps.push(...Object.keys(pkg.devDependencies || {}));
    for (const dep of deps) req.resolve(dep);
    return true;
  } catch { return false; }
}

if (depsReady()) {
  console.log(`${target} dependencies unchanged and cached. Skipping npm install.`);
  process.exit(0);
}

if (!lockPath) throw new Error(`Missing ${target}/package-lock.json`);
const args = ['ci','--prefix',target,target==='frontend'?'--include=dev':'--omit=dev','--prefer-offline','--no-audit','--no-fund','--progress=false'];
if (target==='backend') args.push('--ignore-scripts');
console.log(`Installing locked ${target} dependencies.`);
execFileSync(process.platform==='win32'?'npm.cmd':'npm',args,{ stdio:'inherit',env:{...process.env,NPM_CONFIG_AUDIT:'false',NPM_CONFIG_FUND:'false',NPM_CONFIG_PROGRESS:'false'} });
fs.mkdirSync(nodeModules, { recursive: true });
fs.writeFileSync(marker, hash + '\n');
console.log('Dependency cache marker updated. Future unchanged deploys can skip install.');
