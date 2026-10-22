/**
 * `beforeDevCommand` for `tauri dev`: runs the UI dev server and the server in watch mode
 * side by side. In dev the shell doesn't start the sidecar; the UI talks to this server on
 * its default port. Set APOKORG_MOCK=1 to serve mock adapters.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const children: ChildProcess[] = [];

function run(filter: string, script: string): void {
  const child = spawn(pnpm, ['--filter', filter, script], { stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    console.error(`${filter} ${script} exited with ${code ?? 'a signal'}`);
    stop(code ?? 1);
  });
  children.push(child);
}

function stop(code: number): void {
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    // A shell-spawned pnpm has its own children; kill the whole tree.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

run('@apokorg/server', 'dev');
run('@apokorg/ui', 'dev');
