const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { businessError } = require('./business-errors.cjs');
const { validatePublicUrl } = require('./public-web.cjs');

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_REMOTE_IMAGE_BYTES = 15_000_000;
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif'],
  ['application/pdf', '.pdf'], ['text/plain', '.txt'], ['text/markdown', '.md'],
  ['audio/mpeg', '.mp3'], ['audio/wav', '.wav'], ['audio/mp4', '.m4a'],
  ['video/mp4', '.mp4'], ['video/webm', '.webm'],
]);
const REMOTE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const GENERIC_BINARY_TYPES = new Set(['', 'application/octet-stream', 'binary/octet-stream']);

function normalizeMime(value) {
  const mimeType = String(value ?? '').split(';')[0].trim().toLowerCase();
  if (mimeType === 'image/jpg') return 'image/jpeg';
  if (mimeType === 'audio/x-wav' || mimeType === 'audio/wave' || mimeType === 'audio/vnd.wave') return 'audio/wav';
  if (mimeType === 'text/x-markdown') return 'text/markdown';
  return mimeType;
}

function safePath(root, storageKey) {
  const absoluteRoot = path.resolve(root);
  const key = String(storageKey ?? '').trim();
  if (!key) throw businessError(400, 'ASSET_STORAGE_PATH_INVALID', '素材存储路径无效。');
  const target = path.resolve(absoluteRoot, key);
  if (target === absoluteRoot || !target.startsWith(`${absoluteRoot}${path.sep}`)) throw businessError(400, 'ASSET_STORAGE_PATH_INVALID', '素材存储路径无效。');
  return target;
}

function isUtf8Text(buffer) {
  if (!buffer.length || buffer.includes(0)) return false;
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  let controls = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    if (code < 32 && ![9, 10, 13].includes(code)) controls += 1;
  }
  return controls / Math.max(text.length, 1) < 0.01;
}

function detectFileType(head, sample = head, declaredMimeType = '') {
  const bytes = Buffer.from(head ?? []);
  const inspected = Buffer.from(sample ?? bytes);
  const declared = normalizeMime(declaredMimeType);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: 'image/jpeg', kind: 'IMAGE', extension: '.jpg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: 'image/png', kind: 'IMAGE', extension: '.png' };
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return { mimeType: 'image/gif', kind: 'IMAGE', extension: '.gif' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mimeType: 'image/webp', kind: 'IMAGE', extension: '.webp' };
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-') return { mimeType: 'application/pdf', kind: 'DOCUMENT', extension: '.pdf' };
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return { mimeType: 'audio/mpeg', kind: 'AUDIO', extension: '.mp3' };
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return { mimeType: 'audio/mpeg', kind: 'AUDIO', extension: '.mp3' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return { mimeType: 'audio/wav', kind: 'AUDIO', extension: '.wav' };
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii');
    if (declared === 'audio/mp4' || /^M4[ABP ]$/.test(brand)) return { mimeType: 'audio/mp4', kind: 'AUDIO', extension: '.m4a' };
    return { mimeType: 'video/mp4', kind: 'VIDEO', extension: '.mp4' };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { mimeType: 'video/webm', kind: 'VIDEO', extension: '.webm' };
  if (['text/plain', 'text/markdown'].includes(declared) && isUtf8Text(inspected)) return { mimeType: declared, kind: 'DOCUMENT', extension: MIME_EXTENSIONS.get(declared) };
  return null;
}

async function streamAndHash(readable, target, maxBytes) {
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const hash = crypto.createHash('sha256');
  const samples = [];
  let sampleBytes = 0;
  let sizeBytes = 0;
  const counter = new Transform({
    transform(chunk, _encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) return callback(businessError(413, 'ASSET_FILE_TOO_LARGE', '文件超过 50MB 上限。'));
      hash.update(chunk);
      if (sampleBytes < 8192) {
        const remaining = 8192 - sampleBytes;
        const portion = chunk.subarray(0, remaining);
        samples.push(portion);
        sampleBytes += portion.length;
      }
      callback(null, chunk);
    },
  });
  await pipeline(readable, counter, fs.createWriteStream(target, { flags: 'wx' }));
  if (readable.truncated) throw businessError(413, 'ASSET_FILE_TOO_LARGE', '文件超过 50MB 上限。');
  if (!sizeBytes) throw businessError(400, 'ASSET_FILE_EMPTY', '不能上传空文件。');
  const sample = Buffer.concat(samples, sampleBytes);
  return { sizeBytes, sha256: hash.digest('hex'), head: sample.subarray(0, 32), sample };
}

async function saveUploadedAsset(root, workspaceId, part) {
  const declaredMimeType = normalizeMime(part.mimetype);
  if (!MIME_EXTENSIONS.has(declaredMimeType)) {
    part.file.resume();
    throw businessError(400, 'ASSET_FILE_UNSUPPORTED', '当前只支持图片、PDF、文本、音频和视频文件。');
  }
  const temporaryKey = [workspaceId, 'assets', `${crypto.randomUUID()}.upload`].join('/');
  const temporaryPath = safePath(root, temporaryKey);
  try {
    const result = await streamAndHash(part.file, temporaryPath, MAX_UPLOAD_BYTES);
    const detected = detectFileType(result.head, result.sample, declaredMimeType);
    if (!detected || detected.mimeType !== declaredMimeType) throw businessError(400, 'ASSET_FILE_INVALID', '文件内容与声明格式不一致。');
    const storageKey = [workspaceId, 'assets', `${crypto.randomUUID()}${detected.extension}`].join('/');
    await fsp.rename(temporaryPath, safePath(root, storageKey));
    return {
      storageKey,
      originalFilename: String(part.filename || `素材${detected.extension}`).slice(0, 255),
      mimeType: detected.mimeType,
      kind: detected.kind,
      sizeBytes: result.sizeBytes,
      sha256: result.sha256,
    };
  } catch (error) {
    await fsp.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readBufferLimited(response, maxBytes) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw businessError(413, 'ASSET_REMOTE_TOO_LARGE', '远程图片超过 15MB 上限。');
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
        throw businessError(413, 'ASSET_REMOTE_TOO_LARGE', '远程图片超过 15MB 上限。');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, sizeBytes);
}

async function saveRemoteImageAsset(root, workspaceId, rawUrl, { fetchImpl = fetch, validateUrl = validatePublicUrl } = {}) {
  let url = await validateUrl(rawUrl);
  let response;
  for (let redirects = 0; redirects < 4; redirects += 1) {
    response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: { 'User-Agent': 'ContentEngine/1.0 Image Import', Accept: 'image/webp,image/png,image/jpeg,image/gif', 'Accept-Encoding': 'identity' },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    if (!location) throw businessError(400, 'ASSET_REMOTE_REDIRECT_INVALID', '图片链接跳转缺少目标地址。');
    url = await validateUrl(new URL(location, url).toString());
  }
  if (!response?.ok) throw businessError(400, 'ASSET_REMOTE_DOWNLOAD_FAILED', `下载图片失败（HTTP ${response?.status ?? '网络错误'}）。`);
  const declaredMimeType = normalizeMime(response.headers.get('content-type'));
  if (!REMOTE_IMAGE_TYPES.has(declaredMimeType) && !GENERIC_BINARY_TYPES.has(declaredMimeType)) throw businessError(400, 'ASSET_REMOTE_INVALID', '远程链接返回的不是受支持图片。');
  const declaredSize = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_REMOTE_IMAGE_BYTES) throw businessError(413, 'ASSET_REMOTE_TOO_LARGE', '远程图片超过 15MB 上限。');
  const buffer = await readBufferLimited(response, MAX_REMOTE_IMAGE_BYTES);
  if (!buffer.length) throw businessError(400, 'ASSET_FILE_EMPTY', '远程图片内容为空。');
  const detected = detectFileType(buffer.subarray(0, 32), buffer);
  if (!detected || detected.kind !== 'IMAGE' || (REMOTE_IMAGE_TYPES.has(declaredMimeType) && declaredMimeType !== detected.mimeType)) throw businessError(400, 'ASSET_FILE_INVALID', '远程内容与图片格式不一致。');
  const storageKey = [workspaceId, 'assets', `${crypto.randomUUID()}${detected.extension}`].join('/');
  const target = safePath(root, storageKey);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  try {
    await fsp.writeFile(target, buffer, { flag: 'wx' });
    return {
      storageKey,
      originalFilename: `网络图片${detected.extension}`,
      mimeType: detected.mimeType,
      kind: detected.kind,
      sizeBytes: buffer.length,
      sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
      sourceUrl: url.toString(),
    };
  } catch (error) {
    await fsp.rm(target, { force: true }).catch(() => {});
    throw error;
  }
}

function openAsset(root, storageKey) {
  return fs.createReadStream(safePath(root, storageKey));
}

async function readAssetText(root, storageKey, maxBytes = 20_000) {
  const handle = await fsp.open(safePath(root, storageKey), 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8').replace(/\0/g, '').trim();
  } finally {
    await handle.close();
  }
}

async function removeAssetFile(root, storageKey) {
  await fsp.rm(safePath(root, storageKey), { force: true });
}

async function removeWorkspaceDirectory(root, workspaceId) {
  const segment = String(workspaceId ?? '').trim();
  if (!segment || segment === '.' || segment === '..' || /[\\/]/.test(segment)) throw businessError(400, 'ASSET_STORAGE_PATH_INVALID', '工作空间存储路径无效。');
  await fsp.rm(safePath(root, segment), { recursive: true, force: true });
}

module.exports = {
  MAX_UPLOAD_BYTES,
  MAX_REMOTE_IMAGE_BYTES,
  MIME_EXTENSIONS,
  detectFileType,
  normalizeMime,
  safePath,
  saveUploadedAsset,
  saveRemoteImageAsset,
  openAsset,
  readAssetText,
  removeAssetFile,
  removeWorkspaceDirectory,
};
