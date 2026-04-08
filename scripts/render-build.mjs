 import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, cwd = root, extraEnv = {}) {
  const pretty = [cmd, ...args].join(' ');
  console.log(`\n>>> ${pretty}`);
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: false,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${pretty}`);
  }
}

run(npmCmd, ['install', '--prefix', 'backend', '--registry=https://registry.npmjs.org/']);
run(
  npmCmd,
  ['install', '--prefix', 'frontend', '--include=dev', '--registry=https://registry.npmjs.org/'],
  root,
  {
    NODE_ENV: 'development',
    NPM_CONFIG_PRODUCTION: 'false',
    npm_config_production: 'false',
    NPM_CONFIG_INCLUDE: 'dev',
    npm_config_include: 'dev',
  }
);
run(npmCmd, ['run', 'build', '--prefix', 'frontend'], root, { NODE_ENV: 'development' });
run(process.execPath, [path.join(root, 'scripts', 'copy-spa.mjs')]);

const builtSpa = path.join(root, 'backend', 'public', 'spa', 'index.html');
if (!existsSync(builtSpa)) {
  throw new Error(`Frontend SPA build missing at ${builtSpa}`);
}
console.log(`\nRender build complete. SPA ready at ${builtSpa}`);
