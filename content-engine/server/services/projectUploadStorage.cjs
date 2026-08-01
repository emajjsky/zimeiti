const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { validatePublicUrl } = require('./public-web.cjs');

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif'],
  ['application/pdf', '.pdf'], ['text/plain', '.txt'], ['text/markdown', '.md'],
  ['audio/mpeg', '.mp3'], ['audio/wav', '.wav'], ['audio/x-wav', '.wav'], ['audio/mp4', '.m4a'],
  ['video/mp4', '.mp4'], ['video/webm', '.webm'],
]);
const REMOTE_IMAGE_BYTES = 15_000_000;
const REMOTE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const GENERIC_BINARY_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

function safePath(root, storageKey) {
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, storageKey);
  if (target !== absoluteRoot && !target.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error('素材存储路径无效。');
  return target;
}

async function saveProjectUpload(root, workspaceId, projectId, part) {
  const extension = MIME_EXTENSIONS.get(part.mimetype);
  if (!extension) { part.file.resume(); throw new Error('当前只支持图片、PDF、文本、音频和视频文件。'); }
  const projectSegment = crypto.createHash('sha256').update(projectId).digest('hex').slice(0, 20);
  const storageKey = [workspaceId, projectSegment, `${crypto.randomUUID()}${extension}`].join('/');
  const target = safePath(root, storageKey);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const hash = crypto.createHash('sha256');
  let sizeBytes = 0;
  const counter = new Transform({ transform(chunk, _encoding, callback) { sizeBytes += chunk.length; hash.update(chunk); callback(null, chunk); } });
  try {
    await pipeline(part.file, counter, fs.createWriteStream(target, { flags: 'wx' }));
    if (part.file.truncated) throw new Error('文件超过 50MB 上限。');
    if (sizeBytes === 0) throw new Error('不能上传空文件。');
    return { storageKey, originalFilename: part.filename || `素材${extension}`, mimeType: part.mimetype, sizeBytes, sha256: hash.digest('hex') };
  } catch (error) {
    await fsp.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

async function saveRemoteProjectImage(root, workspaceId, projectId, rawUrl, { fetchImpl = fetch, validateUrl = validatePublicUrl } = {}) {
  let url = await validateUrl(rawUrl);
  let response;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent': 'ContentEngine/1.0 Image Import',
        Accept: 'image/webp,image/png,image/jpeg,image/gif',
        'Accept-Encoding': 'identity',
      },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw new Error('图片链接跳转缺少目标地址。');
    url = await validateUrl(new URL(location, url).toString());
  }
  if (!response?.ok) throw new Error(`下载图片失败（HTTP ${response?.status ?? '网络错误'}）。`);
  const declaredMimeType = String(response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!REMOTE_IMAGE_TYPES.has(declaredMimeType) && !GENERIC_BINARY_TYPES.has(declaredMimeType)) throw new Error('远程链接返回的不是受支持图片。');
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > REMOTE_IMAGE_BYTES) throw new Error('远程图片超过 15MB 上限。');
  const buffer = await readBufferLimited(response, REMOTE_IMAGE_BYTES);
  if (!buffer.length) throw new Error('远程图片内容为空。');
  const detectedMimeType = detectImageMimeType(buffer);
  if (!detectedMimeType || (REMOTE_IMAGE_TYPES.has(declaredMimeType) && declaredMimeType !== detectedMimeType)) throw new Error('远程内容与图片格式不一致。');
  const mimeType = REMOTE_IMAGE_TYPES.has(declaredMimeType) ? declaredMimeType : detectedMimeType;

  const extension = MIME_EXTENSIONS.get(mimeType);
  const projectSegment = crypto.createHash('sha256').update(projectId).digest('hex').slice(0, 20);
  const storageKey = [workspaceId, projectSegment, `${crypto.randomUUID()}${extension}`].join('/');
  const target = safePath(root, storageKey);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    await fsp.writeFile(target, buffer, { flag: 'wx' });
    return {
      storageKey,
      originalFilename: `网络图片${extension}`,
      mimeType,
      sizeBytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      sourceUrl: url.toString(),
    };
  } catch (error) {
    await fsp.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

async function readBufferLimited(response, maxBytes) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error('远程图片超过 15MB 上限。');
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let sizeBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes) {
        await reader.cancel();
        throw new Error('远程图片超过 15MB 上限。');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, sizeBytes);
}

function matchesImageSignature(buffer, mimeType) {
  return detectImageMimeType(buffer) === mimeType;
}

function detectImageMimeType(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

async function removeProjectUpload(root, storageKey) {
  if (!storageKey) return;
  await fsp.rm(safePath(root, storageKey), { force: true });
}

function openProjectUpload(root, storageKey) {
  return fs.createReadStream(safePath(root, storageKey));
}

async function readProjectUploadText(root, storageKey, maxBytes = 20_000) {
  const handle = await fsp.open(safePath(root, storageKey), 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').replace(/\0/g, '').trim();
  } finally { await handle.close(); }
}

module.exports = { MIME_EXTENSIONS, saveProjectUpload, saveRemoteProjectImage, removeProjectUpload, openProjectUpload, readProjectUploadText, safePath, matchesImageSignature };
