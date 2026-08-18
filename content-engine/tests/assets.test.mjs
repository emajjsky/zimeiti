import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { assetView, createAssetStore } from '../server/services/assets.cjs';
import assetStorage from '../server/services/assetStorage.cjs';

const { detectFileType, maxUploadBytesForMime, saveRemoteImageAsset, saveUploadedAsset } = assetStorage;

test('长视频使用独立上传上限，普通素材继续保持五十兆限制', () => {
  assert.equal(maxUploadBytesForMime('video/mp4'), 1024 * 1024 * 1024);
  assert.equal(maxUploadBytesForMime('video/webm'), 1024 * 1024 * 1024);
  assert.equal(maxUploadBytesForMime('image/png'), 50 * 1024 * 1024);
});

const SHA = 'a'.repeat(64);

function filePart({ mimetype, content, filename = 'upload.bin' }) {
  const file = Readable.from([content]);
  file.truncated = false;
  return { mimetype, filename, file };
}

function assetRow(overrides = {}) {
  return {
    id: 'asset-a', workspace_id: 'workspace-a', kind: 'IMAGE', origin: 'UPLOAD', status: 'ACTIVE',
    title: '图片', original_filename: 'image.png', mime_type: 'image/png', size_bytes: '20', sha256: SHA,
    storage_key: 'workspace-a/assets/file.png', source_url: null, source_note: '', copyright_status: 'OWNED',
    project_count: '0', created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

test('上传文件的声明 MIME 与内容不一致时拒绝保存且不残留文件', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'content-engine-assets-invalid-'));
  try {
    const part = filePart({ mimetype: 'image/png', content: Buffer.from('<html>') });
    await assert.rejects(() => saveUploadedAsset(root, 'workspace-a', part), /格式不一致/);
    assert.deepEqual(await fs.promises.readdir(root, { recursive: true }), ['workspace-a', 'workspace-a\\assets']);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('文件内容检测覆盖正式允许的图片、文档、音频和视频格式', () => {
  const samples = [
    [Buffer.from([0xff, 0xd8, 0xff, 0xdb]), 'image/jpeg', 'IMAGE'],
    [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png', 'IMAGE'],
    [Buffer.from('%PDF-1.7'), 'application/pdf', 'DOCUMENT'],
    [Buffer.from('ID3\u0004\u0000\u0000'), 'audio/mpeg', 'AUDIO'],
    [Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]), 'audio/wav', 'AUDIO'],
    [Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 'video/webm', 'VIDEO'],
  ];
  for (const [buffer, mimeType, kind] of samples) assert.deepEqual(detectFileType(buffer, buffer, mimeType), { mimeType, kind, extension: mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/png' ? '.png' : mimeType === 'application/pdf' ? '.pdf' : mimeType === 'audio/mpeg' ? '.mp3' : mimeType === 'audio/wav' ? '.wav' : '.webm' });
});

test('远程候选图原图不可达时使用同一候选的缩略图地址导入', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'content-engine-remote-image-'));
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const requested = [];
  try {
    const stored = await saveRemoteImageAsset(root, 'workspace-a', 'https://images.example/original.jpg', {
      fallbackUrl: 'https://images.example/thumb.jpg',
      validateUrl: async (value) => new URL(value),
      fetchImpl: async (url) => {
        requested.push(url.toString());
        if (url.pathname.endsWith('original.jpg')) throw new TypeError('fetch failed');
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      },
    });
    assert.equal(requested.length, 2);
    assert.match(stored.storageKey, /\.png$/);
    assert.equal(stored.mimeType, 'image/png');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('服务端直连图片超时时使用受控浏览器下载通道', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'content-engine-browser-image-'));
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
  let browserCalls = 0;
  try {
    const stored = await saveRemoteImageAsset(root, 'workspace-a', 'https://images.example/photo.jpg', {
      validateUrl: async (value) => new URL(value),
      fetchImpl: async () => { throw new TypeError('fetch failed'); },
      browserFetch: async (value, validateUrl) => {
        browserCalls += 1;
        return { buffer: jpeg, contentType: 'image/jpeg', url: await validateUrl(value) };
      },
    });
    assert.equal(browserCalls, 1);
    assert.equal(stored.mimeType, 'image/jpeg');
    assert.equal(stored.sizeBytes, jpeg.length);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});

test('素材 DTO 不暴露物理存储键', () => {
  const view = assetView(assetRow());
  assert.equal('storageKey' in view, false);
  assert.equal('storage_key' in view, false);
  assert.equal(view.sizeBytes, 20);
  assert.equal(view.projectCount, 0);
});

test('相同空间相同哈希复用已有素材并删除重复物理文件', async () => {
  const removed = [];
  const existing = assetRow({ id: 'existing-asset' });
  const client = {
    async query(sql) {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/FROM workspace_assets asset/.test(sql)) return { rows: [existing], rowCount: 1 };
      throw new Error(`未处理 SQL: ${sql}`);
    },
  };
  const store = createAssetStore({ query: client.query.bind(client), transaction: async (callback) => callback(client), removeStoredFile: async (storageKey) => removed.push(storageKey) });
  const result = await store.createFromStoredFile('workspace-a', 'user-1', { storageKey: 'workspace-a/assets/duplicate.png', originalFilename: '重复.png', mimeType: 'image/png', kind: 'IMAGE', sizeBytes: 20, sha256: SHA }, { origin: 'UPLOAD', title: '重复图片' });
  assert.equal(result.created, false);
  assert.equal(result.asset.id, 'existing-asset');
  assert.deepEqual(removed, ['workspace-a/assets/duplicate.png']);
});

test('项目链接要求项目和素材属于同一空间', async () => {
  const rows = [
    { rows: [{ project_id: 'project-a' }], rowCount: 1 },
    { rows: [assetRow({ workspace_id: 'workspace-b' })], rowCount: 1 },
  ];
  const store = createAssetStore({ query: async () => rows.shift(), transaction: async () => {} });
  await assert.rejects(
    () => store.linkToProject('workspace-a', 'project-a', 'asset-a', { role: 'VISUAL', scope: 'IMAGING', platforms: ['WECHAT'], notes: '', title: '配图' }),
    (error) => error.code === 'WORKSPACE_FORBIDDEN',
  );
});

test('同一项目重复选择同一素材只保留一条关系', async () => {
  const link = { link_id: 'existing-link', workspace_id: 'workspace-a', project_id: 'project-a', asset_id: 'asset-a', role: 'VISUAL', scope: 'IMAGING', title: '配图', notes: '', platforms_json: ['WECHAT'], created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z' };
  const responses = [
    { rows: [{ project_id: 'project-a' }], rowCount: 1 },
    { rows: [assetRow()], rowCount: 1 },
    { rows: [{ ...assetRow(), ...link }], rowCount: 1 },
  ];
  const store = createAssetStore({ query: async () => responses.shift(), transaction: async () => {} });
  const linked = await store.linkToProject('workspace-a', 'project-a', 'asset-a', { role: 'VISUAL', scope: 'IMAGING', platforms: ['WECHAT'], notes: '', title: '配图' });
  assert.equal(linked.linkId, 'existing-link');
  assert.equal(linked.projectId, 'project-a');
});

test('仍被项目引用的素材不能进入永久删除队列', async () => {
  const client = { async query(sql) {
    if (sql.includes('FROM workspace_assets') && sql.includes('FOR UPDATE')) return { rows: [assetRow()], rowCount: 1 };
    if (sql.includes('count(*)')) return { rows: [{ count: '2' }], rowCount: 1 };
    throw new Error(`删除流程不应继续：${sql}`);
  } };
  const store = createAssetStore({ query: client.query.bind(client), transaction: async (callback) => callback(client) });
  await assert.rejects(() => store.requestDeletion('workspace-a', 'asset-a', 'user-1'), (error) => error.code === 'ASSET_IN_USE');
});

test('空间素材 API 使用显式角色并为内容响应设置私有安全头', async () => {
  const source = await fs.promises.readFile(new URL('../server/index.cjs', import.meta.url), 'utf8');
  assert.match(source, /app\.get\('\/api\/v1\/assets', \{ preHandler: workspaceAccess\.forRole\('VIEWER'\) \}/);
  assert.match(source, /app\.post\('\/api\/v1\/assets', \{ preHandler: workspaceAccess\.forRole\('EDITOR'\) \}/);
  assert.match(source, /app\.post\('\/api\/v1\/projects\/:projectId\/assets\/:assetId', \{ preHandler: workspaceAccess\.forRole\('EDITOR'\) \}/);
  assert.match(source, /app\.delete\('\/api\/v1\/assets\/:assetId', \{ preHandler: workspaceAccess\.forRole\('EDITOR'\) \}/);
  assert.match(source, /Cache-Control', 'private/);
  assert.match(source, /X-Content-Type-Options', 'nosniff'/);
  assert.match(source, /Content-Security-Policy', 'sandbox'/);
});
