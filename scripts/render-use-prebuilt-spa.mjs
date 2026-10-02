import fs from 'node:fs';
import path from 'node:path';

// CC26_686: use the complete, already-packaged SPA directly.
// No frontend build, archive extraction, bundle renaming, or manifest rewriting.
// If index.html references a static public file that lives in frontend/public,
// copy that exact local file into backend/public/spa at build time.
const root = process.cwd();
const spaDir = path.join(root, 'backend', 'public', 'spa');
const frontendPublic = path.join(root, 'frontend', 'public');
const indexFile = path.join(spaDir, 'index.html');

function fail(message) {
  console.error(`Render SPA check failed: ${message}`);
  process.exit(1);
}
function stageFromFrontendPublic(ref) {
  const relative = ref.replace(/^\//, '');
  const source = path.join(frontendPublic, relative);
  const dest = path.join(spaDir, relative);
  if (!fs.existsSync(source)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
  console.log(`Staged packaged public asset: ${ref}`);
  return true;
}

if (!fs.existsSync(indexFile)) fail('backend/public/spa/index.html is missing. Upload the complete DESKTOP_CRM/GITHUB folder.');

const html = fs.readFileSync(indexFile, 'utf8');
const main = html.match(/<meta\s+name=["']cc-main-asset["']\s+content=["']([^"']+)["']/i)?.[1]
  || html.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i)?.[1]
  || '';
if (!main || !main.startsWith('/assets/')) fail('main SPA asset reference is missing from index.html');

const refs = [...html.matchAll(/(?:src|href|content)=["'](\/(?:assets|securelink)\/[^"'?]+)(?:\?[^"']*)?["']/g)].map((m) => m[1]);
const required = new Set(refs);
required.add(main);
required.add('/securelink/index.html');
required.add('/securelink/securelink.js');
required.add('/securelink/securelink.css');
required.add('/securelink/sidebar.js');

const missing = [];
for (const ref of required) {
  const file = path.join(spaDir, ref.slice(1));
  if (!fs.existsSync(file) && !stageFromFrontendPublic(ref)) missing.push(ref);
}
if (missing.length) fail(`missing packaged file(s): ${missing.join(', ')}`);

const mainFile = path.join(spaDir, main.slice(1));
const stat = fs.statSync(mainFile);
if (!stat.isFile() || stat.size < 100000) fail(`main SPA asset looks incomplete: ${main}`);

console.log(`Render SPA ready: ${main} (${stat.size} bytes)`);
console.log('CC26_691 packaged SPA validated. Render serves the latest CRM shell plus the packaged CC26_648-reference candidate profile asset; no frontend compile is required.');
