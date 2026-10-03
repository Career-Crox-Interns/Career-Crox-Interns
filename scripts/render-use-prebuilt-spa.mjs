import fs from 'node:fs';
import path from 'node:path';

// CC26_692: GitHub/Render stable deployment.
// The production frontend is already packaged in backend/public/spa for fast, reliable deploys.
// The frontend source folder is also kept in the repository for development and future edits.
// This validator is intentionally self-contained and does not fetch/copy anything.
const root = process.cwd();
const spaDir = path.join(root, 'backend', 'public', 'spa');
const indexFile = path.join(spaDir, 'index.html');

function fail(message) {
  console.error(`Render SPA check failed: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(indexFile)) {
  fail('backend/public/spa/index.html is missing. Upload the complete DESKTOP_CRM/GITHUB folder.');
}

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
  if (!fs.existsSync(file)) missing.push(ref);
}
if (missing.length) fail(`missing packaged file(s): ${missing.join(', ')}`);

const mainFile = path.join(spaDir, main.slice(1));
const stat = fs.statSync(mainFile);
if (!stat.isFile() || stat.size < 100000) fail(`main SPA asset looks incomplete: ${main}`);

console.log(`Render SPA ready: ${main} (${stat.size} bytes)`);
console.log('CC26_692 packaged SPA validated. Frontend source may remain in the repository while Render serves the prebuilt SPA.');
