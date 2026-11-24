import { spawn } from 'node:child_process';

export async function invoke(executable, argv, { cwd, input, timeout = 120000, newGroup = true, onChunk } = {}) {
  const start = performance.now();
  return new Promise(resolve => {
    const child = spawn(executable, argv, { cwd, stdio: ['pipe', 'pipe', 'pipe'], detached: newGroup && process.platform !== 'win32' });
    let stdout = '', stderr = '', error = null, timedOut = false, timeoutElapsedMs = null, bytes = 0, terminationRequested = false, hardKillTimer;
    const signal = name => {
      if (newGroup && process.platform !== 'win32' && child.pid) { try { process.kill(-child.pid, name); } catch {} }
      else child.kill(name);
    };
    const kill = () => {
      if (terminationRequested) return;
      terminationRequested = true;
      signal('SIGTERM');
      hardKillTimer = setTimeout(() => signal('SIGKILL'), 2000);
      hardKillTimer.unref();
    };
    const timer = setTimeout(() => { timedOut = true; timeoutElapsedMs = performance.now() - start; kill(); }, timeout);
    for (const [stream, name] of [[child.stdout, 'stdout'], [child.stderr, 'stderr']]) stream.setEncoding('utf8').on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 32 * 1024 * 1024) { error = 'output_limit'; kill(); return; }
      if (name === 'stdout') stdout += chunk; else stderr += chunk;
      try { onChunk?.(name, chunk); } catch {}
    });
    child.stdin.on('error', () => {});
    child.on('error', failure => { error = failure.message; });
    child.on('close', (exit, signal) => {
      clearTimeout(timer);
      clearTimeout(hardKillTimer);
      resolve({ stdout, stderr, exit, signal, error, timedOut, elapsedMs: timeoutElapsedMs ?? performance.now() - start });
    });
    child.stdin.end(input ?? '');
  });
}
