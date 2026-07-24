const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

function cliScript() {
  return path.join(path.dirname(require.resolve('bailian-cli/package.json')), 'dist', 'bailian.mjs');
}

function runBailianCli(args, apiKey, timeoutMs = 60_000) {
  const script = cliScript();
  if (!fs.existsSync(script)) return Promise.reject(new Error('服务器未安装百炼 CLI。'));
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...process.env, ...(apiKey ? { DASHSCOPE_API_KEY: apiKey } : {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const append = (current, chunk) => current.length + chunk.length > 1_000_000 ? current : current + chunk;
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk.toString()); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk.toString()); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else if (timedOut) reject(new Error('百炼 CLI 任务超时。'));
      else reject(new Error((stderr || stdout || `百炼 CLI 退出，错误码 ${code}`).replace(/\s+/g, ' ').trim()));
    });
  });
}

module.exports = { cliScript, runBailianCli };
