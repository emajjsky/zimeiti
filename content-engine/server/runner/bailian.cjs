const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

class BailianCliError extends Error {
  constructor(message, details = {}) {
    super(message, { cause: details.cause });
    this.name = 'BailianCliError';
    this.kind = details.kind ?? 'PROCESS_EXIT';
    this.code = `BAILIAN_CLI_${this.kind}`;
    this.exitCode = details.exitCode ?? null;
    this.signal = details.signal ?? null;
    this.durationMs = details.durationMs ?? null;
    this.stdout = details.stdout ?? '';
    this.stderr = details.stderr ?? '';
    this.timedOut = Boolean(details.timedOut);
    this.aborted = Boolean(details.aborted);
  }
}

function classifyBailianCliFailure({ timedOut = false, aborted = false, stderr = '' } = {}) {
  if (timedOut) return 'TIMEOUT';
  if (aborted) return 'ABORTED';
  if (/invalid\s*api\s*key|unauthorized|401\b|authentication/i.test(String(stderr))) return 'AUTH';
  if (/\b(?:429|500|502|503|504)\b|service\s+unavailable|gateway/i.test(String(stderr))) return 'SERVICE';
  return 'PROCESS_EXIT';
}

function cliScript() {
  return path.join(path.dirname(require.resolve('bailian-cli/package.json')), 'dist', 'bailian.mjs');
}

function runBailianCli(args, apiKey, timeoutMs = 60_000, options = {}) {
  const script = cliScript();
  if (!fs.existsSync(script)) return Promise.reject(new BailianCliError('服务器未安装百炼 CLI。', { kind: 'SPAWN' }));
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...(apiKey ? { DASHSCOPE_API_KEY: apiKey } : {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let settled = false;
    const append = (current, chunk) => current.length + chunk.length > 1_000_000 ? current : current + chunk;
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk.toString()); });
    const terminate = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref?.();
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    const abortHandler = () => { aborted = true; terminate(); };
    options.signal?.addEventListener('abort', abortHandler, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortHandler);
    };
    child.on('error', (cause) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new BailianCliError(cause.message, { kind: 'SPAWN', durationMs: Date.now() - startedAt, cause }));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0 && !timedOut && !aborted) return resolve(stdout);
      const kind = classifyBailianCliFailure({ timedOut, aborted, stderr });
      const message = timedOut
        ? '百炼 CLI 任务超时。'
        : aborted
          ? '百炼 CLI 任务已取消。'
          : (stderr || stdout || `百炼 CLI 退出，错误码 ${code}`).replace(/\s+/g, ' ').trim();
      reject(new BailianCliError(message, {
        kind, exitCode: code, signal, durationMs: Date.now() - startedAt,
        stdout, stderr, timedOut, aborted,
      }));
    });
  });
}

module.exports = { BailianCliError, classifyBailianCliFailure, cliScript, runBailianCli };
