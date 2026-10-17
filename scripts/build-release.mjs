import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const spaDir = path.join(root, 'backend/public/spa');
const releaseFile = path.join(root, 'release-manifest.json');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function files(dir) {
  return fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => {
    if (['.git','node_modules','dist'].includes(entry.name)) return [];
    const file = path.join(dir,entry.name);
    return entry.isDirectory() ? files(file) : [file];
  }).sort();
}
function fail(message) { throw new Error(`Release validation failed: ${message}`); }

// Source-upload limits exclude dependencies and files generated during deployment.
const uploadFiles = files(root).filter(f => {
  const rel=path.relative(root,f).replaceAll('\\','/');
  return !rel.startsWith('backend/public/spa/') && rel !== 'release-manifest.json';
});
const frontendCount=uploadFiles.filter(f=>path.relative(root,f).replaceAll('\\','/').startsWith('frontend/')).length;
const remainingCount=uploadFiles.length-frontendCount;
console.log(`GitHub upload source count (informational): frontend ${frontendCount}, all other files ${remainingCount}.`);

if (process.argv.includes('--sync')) {
  const dist = path.join(root,'frontend/dist');
  if (!fs.existsSync(path.join(dist,'index.html'))) fail('Build frontend first.');
  fs.rmSync(spaDir,{recursive:true,force:true});
  fs.cpSync(dist,spaDir,{recursive:true});
  const source = Object.fromEntries(files(path.join(root,'frontend')).map(f=>[path.relative(root,f).replaceAll('\\','/'),sha(f)]));
  const backendSource = Object.fromEntries([...files(path.join(root,'backend/src')),path.join(root,'backend/package.json'),path.join(root,'backend/package-lock.json'),path.join(root,'package.json'),path.join(root,'render.yaml'),...files(path.join(root,'scripts'))].sort().map(f=>[path.relative(root,f).replaceAll('\\','/'),sha(f)]));
  const assets = Object.fromEntries(files(spaDir).map(f=>[path.relative(spaDir,f).replaceAll('\\','/'),sha(f)]));
  fs.writeFileSync(releaseFile,JSON.stringify({ release:'CC841',version:'1.0.841',node:process.version,
    frontend_source_sha256:source,backend_source_sha256:backendSource,spa_sha256:assets,
    native_artifacts:'CC841 preview APK rebuilt and signature verified. Companion dialing does not require default-Phone role or disk-write acknowledgement. Slice navigation, create-state protection, scoped TL submission reviews and duplicate-popup/layout fixes. Windows helper preserved.' },null,2)+'\n');
}
if (!fs.existsSync(releaseFile)) fail('release-manifest.json missing. Run npm run render-build.');
const release = JSON.parse(fs.readFileSync(releaseFile,'utf8'));
for (const [relative,expected] of Object.entries({...release.frontend_source_sha256,...release.backend_source_sha256})) {
  const file = path.resolve(root,relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || sha(file)!==expected) fail(`Source changed: ${relative}. Rebuild it.`);
}
const actualAssets=files(spaDir).map(f=>path.relative(spaDir,f).replaceAll('\\','/'));
if (actualAssets.length !== Object.keys(release.spa_sha256).length || actualAssets.some(f=>!release.spa_sha256[f])) fail('SPA file list differs from the release manifest.');
for (const [relative,expected] of Object.entries(release.spa_sha256)) {
  const file = path.resolve(spaDir,relative);
  if (!file.startsWith(spaDir + path.sep) || !fs.existsSync(file) || sha(file)!==expected) fail(`Missing or modified SPA file: ${relative}`);
}
const html = fs.readFileSync(path.join(spaDir,'index.html'),'utf8');
const main = html.match(/<script[^>]*type=["']module["'][^>]*src=["']([^"'?]+)/)?.[1];
if (!main?.startsWith('/assets/')) fail('Compiled module entry missing.');
const refs = [...html.matchAll(/(?:src|href)=["'](\/(?:assets|securelink)\/[^"'?]+)(?:\?[^"']*)?["']/g)].map(m=>m[1]);
for (const ref of new Set([...refs,'/securelink/index.html','/securelink/securelink.js','/securelink/securelink.css','/securelink/sidebar.js'])) {
  if (!fs.existsSync(path.join(spaDir,ref.slice(1)))) fail(`Missing referenced file: ${ref}`);
}
console.log(`${release.release} source and ${Object.keys(release.spa_sha256).length} SPA files verified; entry ${main}.`);
