const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'], ['image/png', '.png'], ['image/webp', '.webp'], ['image/gif', '.gif'],
  ['application/pdf', '.pdf'], ['text/plain', '.txt'], ['text/markdown', '.md'],
  ['audio/mpeg', '.mp3'], ['audio/wav', '.wav'], ['audio/x-wav', '.wav'], ['audio/mp4', '.m4a'],
  ['video/mp4', '.mp4'], ['video/webm', '.webm'],
]);

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

async function removeProjectUpload(root, storageKey) {
  if (!storageKey) return;
  await fsp.rm(safePath(root, storageKey), { force: true });
}

function openProjectUpload(root, storageKey) {
  return fs.createReadStream(safePath(root, storageKey));
}

module.exports = { MIME_EXTENSIONS, saveProjectUpload, removeProjectUpload, openProjectUpload, safePath };
