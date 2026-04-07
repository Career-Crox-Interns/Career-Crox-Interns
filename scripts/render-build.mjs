import { spawnSync } from 'node:child_process';
    import { existsSync } from 'node:fs';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const root = path.resolve(__dirname, '..');
    const frontendDir = path.join(root, 'frontend');
    const backendDir = path.join(root, 'backend');
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const pythonCmds = process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'];

    function run(cmd, args, opts = {}) {
      const pretty = [cmd, ...args].join(' ');
      console.log(`
>>> ${pretty}`);
      const result = spawnSync(cmd, args, {
        cwd: opts.cwd || root,
        stdio: 'inherit',
        env: { ...process.env, ...(opts.env || {}) },
        shell: false,
      });
      if (result.status !== 0) {
        throw new Error(`Command failed (${result.status}): ${pretty}`);
      }
    }

    function tryPythonInstall() {
      for (const cmd of pythonCmds) {
        const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore', shell: false });
        if (probe.status === 0) {
          run(cmd, ['-m', 'pip', 'install', '--user', '-r', 'requirements.txt']);
          return true;
        }
      }
      console.warn('Python not found during build. Skipping pip install.');
      return false;
    }

    function buildFrontend() {
      try {
        run(npmCmd, ['--prefix', 'frontend', 'exec', 'vite', 'build']);
        return;
      } catch (error) {
        console.warn(`Local vite build failed: ${error.message}`);
      }
      run(npmCmd, ['exec', '--yes', '--package', 'vite@5.4.19', 'vite', 'build'], { cwd: frontendDir });
    }

    run(npmCmd, ['install', '--prefix', 'backend', '--registry=https://registry.npmjs.org/']);
    run(npmCmd, ['install', '--prefix', 'frontend', '--registry=https://registry.npmjs.org/']);
    tryPythonInstall();
    buildFrontend();
    run(process.execPath, [path.join(root, 'scripts', 'copy-spa.mjs')]);

    const builtSpa = path.join(root, 'backend', 'public', 'spa', 'index.html');
    if (!existsSync(builtSpa)) {
      throw new Error(`Frontend SPA build missing at ${builtSpa}`);
    }
    console.log(`
Render build complete. SPA ready at ${builtSpa}`);
