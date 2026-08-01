# Workspace and Asset Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. This project explicitly requires inline execution; do not dispatch subagents. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现一个用户多工作空间的显式隔离、空间创建/切换/删除，以及空间级素材上传、预览、删除和跨项目复用，并无损迁移现有项目文件与配图绑定。

**Architecture:** 所有空间内请求通过统一 `X-Workspace-Id` 上下文中间件完成成员和角色校验，领域服务只接收已验证的 `workspaceId`。`workspace_assets` 成为文件唯一所有者，`project_asset_links` 只表达项目用途；项目引用、配图方案和研究快照不再拥有文件元数据。前端会话保存空间列表与当前空间，切换空间通过应用根节点重新挂载清理全部空间内状态。

**Tech Stack:** React 19、TypeScript、Fastify 5、PostgreSQL、Redis/BullMQ、Node.js `node:test`、Playwright Python。

## Global Constraints

- 当前工作空间不得由服务端排序或默认选取；删除 `currentWorkspace()`。
- 除身份和工作空间管理接口外，所有空间内 API 必须携带 `X-Workspace-Id`。
- 服务端每次请求校验 JWT、工作空间成员关系、空间状态和最低角色。
- 项目、素材、账号及后续发布数据不得写回整份 `workspace_snapshots`。
- 空间素材是文件唯一业务所有者；项目解除引用不得删除文件。
- 同一空间以 `workspace_id + sha256` 去重；不同空间不共享业务素材记录。
- 已被项目引用的素材删除返回 `409 ASSET_IN_USE`，不得级联破坏项目。
- 上传单文件上限保持 50MB；远程图片上限保持 15MB；文件类型以内容检测结果为准。
- 私有文件接口不得返回 `storage_key`、物理路径或永久公开 URL。
- 空间删除只允许 `OWNER`，必须先展示影响范围并输入完整空间名称。
- 允许删除最后一个空间；完成后保持登录并进入创建空间页。
- 不建立新旧素材双写，不保留旧文件所有权字段、旧 API 或隐藏回退逻辑。
- 现有 8 个项目、33 份文件素材、29 个配图绑定迁移后数量、大小和 SHA-256 必须一致。
- `03_IMPLEMENT_内容引擎.md` 只在实现、迁移和验收全部完成后更新。

---

## File Structure

### Server

- Create `content-engine/server/migrations/027_workspace_asset_foundation.sql`: 工作空间状态、用户空间偏好、空间素材、项目素材引用、可靠存储删除任务及现有文件迁移。
- Create `content-engine/server/services/business-errors.cjs`: 稳定业务错误对象与公共错误响应字段。
- Create `content-engine/server/services/workspaces.cjs`: 空间列表、创建、重命名、选择、影响预览和删除事务。
- Create `content-engine/server/services/workspace-context.cjs`: `X-Workspace-Id` 解析、成员校验和角色授权。
- Create `content-engine/server/services/assets.cjs`: 空间素材、项目素材引用、去重和删除状态机。
- Create `content-engine/server/services/assetStorage.cjs`: 上传、远程导入、内容检测、鉴权读取和物理删除。
- Create `content-engine/server/services/storageDeletion.cjs`: 素材文件与整空间目录的幂等删除执行器。
- Modify `content-engine/server/index.cjs:190-2725`: 注册领域服务和路由，删除隐式空间查询，迁移项目素材及配图接口。
- Modify `content-engine/server/config.cjs`: 增加生产环境空间永久删除开关。
- Modify `content-engine/server/worker.cjs:1-970`: 执行 `STORAGE_DELETE` 任务。
- Delete `content-engine/server/services/projectUploadStorage.cjs`: 所有调用切换完成后删除旧项目级文件所有权服务。

### Web

- Create `content-engine/src/domain/workspace.ts`: `WorkspaceSummary`、`WorkspaceRole`、`WebSession`、删除影响类型。
- Create `content-engine/src/domain/assets.ts`: `WorkspaceAsset`、`ProjectAsset`、筛选与写入类型。
- Create `content-engine/src/data/sessionStore.ts`: 会话读取、写入和当前空间切换。
- Create `content-engine/src/components/workspace/WorkspaceSwitcher.tsx`: 顶部空间切换器。
- Create `content-engine/src/components/assets/AssetPreviewDialog.tsx`: 统一私有素材大图/文件预览。
- Create `content-engine/src/components/assets/AssetPickerDialog.tsx`: 项目和配图复用的空间素材选择器。
- Create `content-engine/src/workspaces/assets/AssetLibrary.tsx`: 全局素材库。
- Create `content-engine/src/workspaces/settings/WorkspaceManagementSettings.tsx`: 空间列表、创建、重命名、影响预览和删除。
- Modify `content-engine/src/data/webApi.ts:1-214`: 自动注入空间请求头，新增空间与素材 API。
- Modify `content-engine/src/data/localRepository.ts:1-210`: 加载当前空间状态，不读取单空间会话形状。
- Modify `content-engine/src/domain/creative.ts:66-100`: 文件资料改为 `ProjectAsset`，外链继续使用 `ProjectReference`。
- Modify `content-engine/src/domain/content.ts:160-190`: 配图字段改为素材 ID。
- Modify `content-engine/src/domain/visual-plan.mjs:520-630`: 使用 `assetId` 和参考素材 ID。
- Modify `content-engine/src/domain/visual-plan.d.mts`: 与实现保持相同字段。
- Modify `content-engine/src/workspaces/create/ProjectMaterials.tsx:1-195`: 从空间素材选择或上传并建立项目引用。
- Modify `content-engine/src/workspaces/create/VisualWorkspace.tsx:1-500`: 使用空间素材、统一预览和素材 ID。
- Modify `content-engine/src/workspaces/settings/WorkspaceProfileSettings.tsx:1-70`: 仅编辑当前空间内容偏好，不再承担空间主体管理。
- Modify `content-engine/src/workspaces/SettingsWorkspace.tsx:1-40`: 接入真实空间管理页。
- Modify `content-engine/src/main.tsx:50-285,668-683`: 空间门禁、根节点重挂载、切换器、素材库和空间管理。
- Modify `content-engine/src/styles.css`: 空间选择、素材库、预览、删除确认和移动端样式。

### Tests and scripts

- Create `content-engine/tests/workspace-assets-migration.test.mjs`.
- Create `content-engine/tests/workspace-context.test.mjs`.
- Create `content-engine/tests/workspaces.test.mjs`.
- Create `content-engine/tests/assets.test.mjs`.
- Create `content-engine/tests/workspace-request-context.test.mjs`.
- Create `content-engine/tests/workspace-assets.e2e.py`.
- Modify `content-engine/tests/project-materials.test.mjs`.
- Modify `content-engine/tests/project-research-agent.test.mjs`.
- Modify `content-engine/tests/visual-plan.test.mjs`.
- Modify `content-engine/tests/visual-planning.test.mjs`.
- Modify `content-engine/tests/delivery-workflow.test.mjs`.
- Modify `content-engine/tests/storage-boundaries.test.mjs`.
- Modify `content-engine/tests/creative-workspace.e2e.py`.
- Modify `content-engine/tests/visual-workspace.e2e.py`.
- Modify `content-engine/scripts/recover-content-projects.cjs`: 恢复脚本输出空间素材和素材 ID，不恢复旧文件引用字段。
- Modify `docs/02_PLAN_内容引擎.md`: 阶段 A 完成后记录真实状态。
- Modify `docs/03_IMPLEMENT_内容引擎.md`: 全部验证通过后记录实现和验收证据。

---

### Task 1: 建立工作空间与素材正式数据库模型

**Files:**

- Create: `content-engine/server/migrations/027_workspace_asset_foundation.sql`
- Create: `content-engine/tests/workspace-assets-migration.test.mjs`
- Modify: `content-engine/tests/storage-boundaries.test.mjs`

**Interfaces:**

- Produces: `workspaces.status`, `user_workspace_preferences`, `workspace_assets`, `project_asset_links`, `storage_deletion_jobs`。
- Produces: `project_research_materials.asset_link_id`。
- Produces: 已迁移的 `ContentProject.delivery.platforms[*].visual.plan[*].assetId`、`coverAssetId`、`assetIds`。
- Removes: `project_references` 的 `FILE` 行及 `storage_key/original_filename/mime_type/size_bytes/sha256` 文件所有权字段。

- [ ] **Step 1: 写迁移结构失败测试**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../server/migrations/027_workspace_asset_foundation.sql', import.meta.url), 'utf8');

test('工作空间与素材迁移建立正式领域表和跨空间约束', () => {
  assert.match(migration, /ALTER TABLE workspaces[\s\S]*status text NOT NULL DEFAULT 'ACTIVE'/);
  assert.match(migration, /CREATE TABLE user_workspace_preferences/);
  assert.match(migration, /CREATE TABLE workspace_assets/);
  assert.match(migration, /UNIQUE \(workspace_id, sha256\)/);
  assert.match(migration, /CREATE TABLE project_asset_links/);
  assert.match(migration, /FOREIGN KEY \(workspace_id, asset_id\)/);
  assert.match(migration, /CREATE TABLE storage_deletion_jobs/);
});

test('文件参考迁入空间素材并删除旧所有权字段', () => {
  assert.match(migration, /INSERT INTO workspace_assets/);
  assert.match(migration, /INSERT INTO project_asset_links/);
  assert.match(migration, /assetReferenceId/);
  assert.match(migration, /assetId/);
  assert.match(migration, /DELETE FROM project_references WHERE source_type = 'FILE'/);
  assert.match(migration, /DROP COLUMN storage_key/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/workspace-assets-migration.test.mjs tests/storage-boundaries.test.mjs`

Expected: FAIL，因为 `027_workspace_asset_foundation.sql` 尚不存在。

- [ ] **Step 3: 写工作空间与素材表结构**

```sql
ALTER TABLE workspaces
  ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'DELETING')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE user_workspace_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active_workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('IMAGE','DOCUMENT','AUDIO','VIDEO','OTHER')),
  origin text NOT NULL CHECK (origin IN ('UPLOAD','AI_GENERATED','WEB_IMPORT')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED','DELETING')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL,
  source_url text,
  source_note text NOT NULL DEFAULT '',
  copyright_status text NOT NULL DEFAULT 'PENDING'
    CHECK (copyright_status IN ('PENDING','OWNED','LICENSED','OPEN_LICENSE','PROHIBITED')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, sha256),
  UNIQUE (workspace_id, storage_key)
);

CREATE TABLE project_asset_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  project_id text NOT NULL,
  asset_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('FACT','OPINION','STRUCTURE','VOICE','HOOK','VISUAL','NEGATIVE')),
  scope text NOT NULL CHECK (scope IN ('PROJECT','RESEARCH','WRITING','IMAGING')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  platforms_json jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(platforms_json) = 'array'),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, project_id) REFERENCES content_projects(workspace_id, project_id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, asset_id) REFERENCES workspace_assets(workspace_id, id) ON DELETE RESTRICT,
  UNIQUE (workspace_id, project_id, asset_id)
);

CREATE TABLE storage_deletion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('ASSET','WORKSPACE','ORPHAN_FILE')),
  target_id uuid NOT NULL,
  storage_key text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE UNIQUE INDEX storage_deletion_active_target_idx
  ON storage_deletion_jobs (workspace_id, target_type, target_id)
  WHERE status IN ('PENDING','RUNNING');
```

`storage_deletion_jobs.workspace_id` 故意不建立到 `workspaces` 的级联外键：删除整个空间后，删除任务仍需保留成功/失败审计。领域服务负责验证任务创建时的空间归属。

现有单空间用户写入最后使用偏好；多空间用户保持 `NULL`，登录后必须主动选择，不能由迁移脚本猜测：

```sql
INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
SELECT member.user_id, (array_agg(member.workspace_id ORDER BY workspace.created_at, member.workspace_id))[1]
FROM workspace_members member
JOIN workspaces workspace ON workspace.id = member.workspace_id AND workspace.status = 'ACTIVE'
GROUP BY member.user_id
HAVING count(*) = 1
ON CONFLICT (user_id) DO NOTHING;

UPDATE workspace_snapshots
SET state_json = state_json #- '{workspace,name}' #- '{workspace,materialRoot}';
```

空间名称只保存在 `workspaces.name`；服务端加载状态时组合到 DTO。Web 环境的文件实际存储由服务端管理，删除无效的客户端 `materialRoot` 偏好。

- [ ] **Step 4: 写现有文件回填和项目 JSON 转换**

迁移使用 `DISTINCT ON (workspace_id, sha256)` 选择每个空间的规范素材 ID，再让全部旧文件参考映射到该素材。用临时 PL/pgSQL 函数逐平台重写配图主素材、封面素材、素材数组和参考素材；映射不到素材时抛错并回滚整个迁移：

```sql
-- old project_references.id -> canonical workspace_assets.id
CREATE TEMP TABLE migrated_asset_ids AS
SELECT old.id AS reference_id, canonical.id AS asset_id, old.workspace_id
FROM project_references old
JOIN LATERAL (
  SELECT candidate.id
  FROM project_references candidate
  WHERE candidate.workspace_id = old.workspace_id
    AND candidate.source_type = 'FILE'
    AND candidate.sha256 = old.sha256
  ORDER BY candidate.created_at, candidate.id
  LIMIT 1
) canonical ON true
WHERE old.source_type = 'FILE';

INSERT INTO storage_deletion_jobs
  (workspace_id, target_type, target_id, storage_key, status)
SELECT old.workspace_id, 'ORPHAN_FILE', old.id, old.storage_key, 'PENDING'
FROM project_references old
JOIN migrated_asset_ids mapping ON mapping.reference_id = old.id AND mapping.workspace_id = old.workspace_id
JOIN workspace_assets asset ON asset.id = mapping.asset_id AND asset.workspace_id = old.workspace_id
WHERE old.source_type = 'FILE' AND old.storage_key <> asset.storage_key;

CREATE FUNCTION migrated_asset_id(p_workspace_id uuid, p_reference_id text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE resolved uuid;
BEGIN
  IF NULLIF(p_reference_id, '') IS NULL THEN RETURN NULL; END IF;
  SELECT asset_id INTO resolved
  FROM migrated_asset_ids
  WHERE workspace_id = p_workspace_id AND reference_id = p_reference_id::uuid;
  IF resolved IS NULL THEN RAISE EXCEPTION '无法迁移文件引用 %', p_reference_id; END IF;
  RETURN resolved;
END $$;

CREATE FUNCTION migrate_project_asset_ids(p_workspace_id uuid, p_project jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  result jsonb := p_project;
  platform_key text;
  platform_value jsonb;
  visual jsonb;
  item jsonb;
  reference_item jsonb;
  rewritten_plan jsonb;
  rewritten_references jsonb;
  rewritten_asset_ids jsonb;
BEGIN
  FOR platform_key, platform_value IN
    SELECT key, value FROM jsonb_each(COALESCE(p_project #> '{delivery,platforms}', '{}'::jsonb))
  LOOP
    visual := platform_value->'visual';
    IF visual IS NULL THEN CONTINUE; END IF;

    rewritten_plan := '[]'::jsonb;
    FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(visual->'plan', '[]'::jsonb))
    LOOP
      rewritten_references := '[]'::jsonb;
      FOR reference_item IN SELECT value FROM jsonb_array_elements(COALESCE(item->'references', '[]'::jsonb))
      LOOP
        rewritten_references := rewritten_references || jsonb_build_array(
          (reference_item - 'referenceId') || jsonb_build_object(
            'assetId', migrated_asset_id(p_workspace_id, reference_item->>'referenceId')
          )
        );
      END LOOP;
      item := (item - 'assetReferenceId' - 'references') || jsonb_build_object(
        'assetId', migrated_asset_id(p_workspace_id, item->>'assetReferenceId'),
        'references', rewritten_references
      );
      rewritten_plan := rewritten_plan || jsonb_build_array(item);
    END LOOP;

    SELECT COALESCE(jsonb_agg(to_jsonb(migrated_asset_id(p_workspace_id, value))), '[]'::jsonb)
      INTO rewritten_asset_ids
    FROM jsonb_array_elements_text(COALESCE(visual->'assetReferenceIds', '[]'::jsonb));

    visual := (visual - 'coverReferenceId' - 'assetReferenceIds' - 'plan') || jsonb_build_object(
      'coverAssetId', migrated_asset_id(p_workspace_id, visual->>'coverReferenceId'),
      'assetIds', rewritten_asset_ids,
      'plan', rewritten_plan
    );
    result := jsonb_set(result, ARRAY['delivery','platforms',platform_key,'visual'], visual, true);
  END LOOP;
  RETURN result;
END $$;

UPDATE content_projects project
SET project_json = migrate_project_asset_ids(project.workspace_id, project.project_json);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM content_projects
    WHERE project_json::text LIKE '%assetReferenceId%'
       OR project_json::text LIKE '%coverReferenceId%'
       OR project_json::text LIKE '%assetReferenceIds%'
  ) THEN
    RAISE EXCEPTION '项目配图仍包含旧素材引用字段';
  END IF;
END $$;

DROP FUNCTION migrate_project_asset_ids(uuid, jsonb);
DROP FUNCTION migrated_asset_id(uuid, text);
```

随后增加 `project_research_materials.asset_link_id`，把旧文件 `reference_id` 迁入，重建 `num_nonnulls(input_id, reference_id, asset_link_id) = 1` 约束，最后删除旧 `FILE` 行和文件字段。

- [ ] **Step 5: 运行迁移结构测试**

Run: `node --test tests/workspace-assets-migration.test.mjs tests/storage-boundaries.test.mjs`

Expected: PASS。

- [ ] **Step 6: 提交数据库模型**

```powershell
git add content-engine/server/migrations/027_workspace_asset_foundation.sql content-engine/tests/workspace-assets-migration.test.mjs content-engine/tests/storage-boundaries.test.mjs
git commit -m "feat: add workspace asset schema"
```

### Task 2: 建立工作空间领域服务与显式请求上下文

**Files:**

- Create: `content-engine/server/services/business-errors.cjs`
- Create: `content-engine/server/services/workspaces.cjs`
- Create: `content-engine/server/services/workspace-context.cjs`
- Create: `content-engine/tests/workspaces.test.mjs`
- Create: `content-engine/tests/workspace-context.test.mjs`
- Modify: `content-engine/server/index.cjs:190-272`

**Interfaces:**

- Produces: `businessError(statusCode, code, message, details?)`。
- Produces: `createWorkspaceStore({ query, transaction, defaultState })`。
- Produces: `createWorkspaceAccess({ query, authenticate }).forRole(minimumRole)`。
- Produces: `workspaceView(row) -> { id, name, role, status }`。
- Produces request shape: `request.workspace = { id, name, role, status }`。

- [ ] **Step 1: 写工作空间服务失败测试**

```js
test('登录会话返回全部空间和合法的最后使用空间', async () => {
  const store = createWorkspaceStore(fakeDatabase());
  const session = await store.sessionForUser('user-1');
  assert.deepEqual(session.workspaces.map(({ id }) => id), ['workspace-a', 'workspace-b']);
  assert.equal(session.activeWorkspaceId, 'workspace-b');
});

test('没有空间的用户返回空列表而不是隐式报错', async () => {
  const store = createWorkspaceStore(fakeDatabase({ memberships: [] }));
  assert.deepEqual(await store.sessionForUser('user-1'), { workspaces: [], activeWorkspaceId: null });
});
```

- [ ] **Step 2: 写上下文鉴权失败测试**

```js
test('空间请求头缺失时返回稳定错误码', async () => {
  const access = createWorkspaceAccess({ query: async () => ({ rows: [] }), authenticate: async () => {} });
  const request = { headers: {}, user: { sub: 'user-1' } };
  await assert.rejects(() => access.resolve(request, 'VIEWER'), (error) => {
    assert.equal(error.statusCode, 400);
    assert.equal(error.code, 'WORKSPACE_REQUIRED');
    return true;
  });
});

test('编辑者不能执行 OWNER 操作', async () => {
  const access = createWorkspaceAccess({ query: memberQuery('EDITOR'), authenticate: async () => {} });
  await assert.rejects(() => access.resolve(requestFor('workspace-a'), 'OWNER'), (error) => error.code === 'WORKSPACE_FORBIDDEN');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test tests/workspaces.test.mjs tests/workspace-context.test.mjs`

Expected: FAIL，因为三个服务文件尚不存在。

- [ ] **Step 4: 实现稳定业务错误**

```js
function businessError(statusCode, code, message, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function errorPayload(error) {
  return {
    message: publicErrorMessage(error),
    ...(error?.code ? { code: error.code } : {}),
    ...(error?.details ? { details: error.details } : {}),
  };
}
```

- [ ] **Step 5: 实现工作空间列表、创建、重命名和最后选择**

```js
function createWorkspaceStore({ query, transaction, defaultState }) {
  function workspaceView(row) {
    return { id: row.id, name: row.name, role: row.role, status: row.status };
  }

  async function sessionForUser(userId) {
    const memberships = await query(`SELECT w.id, w.name, w.status, m.role
      FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND w.status = 'ACTIVE'
      ORDER BY w.created_at, w.id`, [userId]);
    const preference = await query('SELECT active_workspace_id FROM user_workspace_preferences WHERE user_id = $1', [userId]);
    const allowed = new Set(memberships.rows.map((row) => row.id));
    const preferred = preference.rows[0]?.active_workspace_id;
    return { workspaces: memberships.rows.map(workspaceView), activeWorkspaceId: allowed.has(preferred) ? preferred : null };
  }

  async function select(userId, workspaceId) {
    await assertMembership(userId, workspaceId, 'VIEWER');
    await query(`INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
      VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE
      SET active_workspace_id = excluded.active_workspace_id, updated_at = now()`, [userId, workspaceId]);
    return sessionForUser(userId);
  }

  async function create(userId, name) {
    return transaction(async (client) => {
      const workspace = await client.query(
        "INSERT INTO workspaces (name, owner_id) VALUES ($1, $2) RETURNING id, name, status",
        [name.trim(), userId],
      );
      await client.query("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')", [workspace.rows[0].id, userId]);
      await client.query('INSERT INTO workspace_snapshots (workspace_id, state_json) VALUES ($1, $2)', [workspace.rows[0].id, JSON.stringify(defaultState(workspace.rows[0].name))]);
      await client.query(`INSERT INTO user_workspace_preferences (user_id, active_workspace_id)
        VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET active_workspace_id = excluded.active_workspace_id, updated_at = now()`, [userId, workspace.rows[0].id]);
      return workspaceView({ ...workspace.rows[0], role: 'OWNER' });
    });
  }

  async function rename(userId, workspaceId, name) {
    await assertMembership(userId, workspaceId, 'OWNER');
    const result = await query("UPDATE workspaces SET name = $3, updated_at = now() WHERE id = $2 AND owner_id = $1 AND status = 'ACTIVE' RETURNING id, name, status", [userId, workspaceId, name.trim()]);
    if (!result.rowCount) throw businessError(404, 'WORKSPACE_NOT_FOUND', '没有找到可重命名的工作空间。');
    return workspaceView({ ...result.rows[0], role: 'OWNER' });
  }

  return { sessionForUser, create, rename, select, assertMembership };
}
```

创建空间必须在单事务内写入 `workspaces`、`workspace_members`、`workspace_snapshots` 和 `user_workspace_preferences`。

- [ ] **Step 6: 实现统一空间上下文**

```js
const roleRank = { VIEWER: 0, EDITOR: 1, OWNER: 2 };

function createWorkspaceAccess({ query, authenticate }) {
  async function resolve(request, minimumRole = 'VIEWER') {
    const workspaceId = String(request.headers['x-workspace-id'] ?? '').trim();
    if (!workspaceId) throw businessError(400, 'WORKSPACE_REQUIRED', '请选择工作空间后再继续。');
    const result = await query(`SELECT w.id, w.name, w.status, m.role
      FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND m.workspace_id = $2`, [request.user.sub, workspaceId]);
    if (!result.rowCount) throw businessError(403, 'WORKSPACE_FORBIDDEN', '你无权访问这个工作空间。');
    const workspace = result.rows[0];
    if (workspace.status !== 'ACTIVE') throw businessError(423, 'WORKSPACE_DELETING', '这个工作空间正在删除，不能继续操作。');
    if (roleRank[workspace.role] < roleRank[minimumRole]) throw businessError(403, 'WORKSPACE_FORBIDDEN', '当前角色无权执行这个操作。');
    request.workspace = workspace;
  }

  return { resolve, forRole: (role) => [authenticate, (request) => resolve(request, role)] };
}
```

- [ ] **Step 7: 将错误处理器返回稳定错误码**

修改 `server/index.cjs` 的全局错误处理，只对业务错误返回 `code/details`，Zod 和内部异常继续只返回安全中文消息。

- [ ] **Step 8: 运行测试并提交**

Run: `node --test tests/workspaces.test.mjs tests/workspace-context.test.mjs tests/http-errors.test.mjs`

Expected: PASS。

```powershell
git add content-engine/server/services/business-errors.cjs content-engine/server/services/workspaces.cjs content-engine/server/services/workspace-context.cjs content-engine/server/index.cjs content-engine/tests/workspaces.test.mjs content-engine/tests/workspace-context.test.mjs content-engine/tests/http-errors.test.mjs
git commit -m "feat: add explicit workspace context"
```

### Task 3: 切换全部服务端路由与 Web API 会话

**Files:**

- Create: `content-engine/src/domain/workspace.ts`
- Create: `content-engine/src/data/sessionStore.ts`
- Create: `content-engine/tests/workspace-request-context.test.mjs`
- Modify: `content-engine/server/index.cjs:218-2725`
- Modify: `content-engine/src/data/webApi.ts:1-214`
- Modify: `content-engine/src/data/localRepository.ts:1-55`
- Modify: `content-engine/tests/creative-workspace.e2e.py`
- Modify: `content-engine/tests/visual-workspace.e2e.py`

**Interfaces:**

- Produces `WorkspaceSummary = { id, name, role, status }`。
- Produces `WebSession = { accessToken, user, workspaces, activeWorkspaceId }`。
- Produces `sessionStore.setActiveWorkspace(workspaceId)`。
- All `request()` calls except explicit `{ workspaceScoped: false }` add `X-Workspace-Id`。

- [ ] **Step 1: 写禁止隐式空间和请求头失败测试**

```js
test('服务端不再包含隐式首空间选择', () => {
  assert.doesNotMatch(server, /function currentWorkspace/);
  assert.doesNotMatch(server, /ORDER BY m\.role = 'OWNER'.*LIMIT 1/s);
  assert.doesNotMatch(server, /currentWorkspace\(/);
});

test('Web API 为全部空间内请求注入当前空间', () => {
  assert.match(webApi, /'X-Workspace-Id': session\.activeWorkspaceId/);
  assert.match(webApi, /workspaceScoped = true/);
  assert.match(webApi, /auth\/me[\s\S]*workspaceScoped: false/);
  assert.match(webApi, /project-files[\s\S]*'X-Workspace-Id'/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/workspace-request-context.test.mjs tests/storage-boundaries.test.mjs`

Expected: FAIL，仍存在 `currentWorkspace()` 且客户端不发送空间请求头。

- [ ] **Step 3: 改造身份响应和空间管理 API**

注册、登录和 `auth/me` 统一返回：

```js
{
  user: { id, email, display_name },
  workspaces: [{ id, name, role: 'OWNER', status: 'ACTIVE' }],
  activeWorkspaceId: workspaceId,
  accessToken,
}
```

新增并注册：

```js
app.get('/api/v1/workspaces', { preHandler: authenticate }, listWorkspaces);
app.post('/api/v1/workspaces', { preHandler: authenticate }, createWorkspace);
app.patch('/api/v1/workspaces/:workspaceId', { preHandler: authenticate }, renameWorkspace);
app.put('/api/v1/me/active-workspace', { preHandler: authenticate }, selectWorkspace);
```

这些工作空间管理接口从路径或请求体读取目标，不要求 `X-Workspace-Id`，但仍逐次校验用户身份和角色。

- [ ] **Step 4: 把全部空间内路由改为显式角色**

读接口使用：

```js
app.get('/api/v1/creative/projects', { preHandler: workspaceAccess.forRole('VIEWER') }, async (request) => {
  return { projects: (await loadCreativeState({ query }, request.workspace.id)).projects };
});
```

项目、素材引用、情报等普通写接口使用 `EDITOR`；凭据、模型连接和空间危险操作使用 `OWNER`。每个处理器只写：

```js
const workspace = request.workspace;
```

完成后删除 `currentWorkspace()`，并用以下命令证明无残留：

Run: `rg -n "currentWorkspace\(|ORDER BY m\.role = 'OWNER'.*LIMIT 1" server src tests`

Expected: 无输出。

`GET /workspace/state` 从 `request.workspace.name` 组合当前名称；`PATCH /workspace/preferences` 不再接收 `name` 或 `materialRoot`。重命名只走 `PATCH /workspaces/:workspaceId`，确保空间名称只有一个事实来源。

同步修改 `defaultState(name)`：`state_json.workspace` 只包含 `primaryTopics`、`accountPositioning`、`targetAudience`、`enabledPlatforms`、`setupCompleted`；`name` 仅用于初始化飞书模板标题，不写入空间偏好对象。

- [ ] **Step 5: 实现新的客户端会话存储和请求选项**

```ts
export type WorkspaceSummary = {
  id: string;
  name: string;
  role: 'OWNER' | 'EDITOR' | 'VIEWER';
  status: 'ACTIVE' | 'DELETING';
};

export type WebSession = {
  accessToken: string;
  user: { id: string; email: string; display_name?: string };
  workspaces: WorkspaceSummary[];
  activeWorkspaceId: string | null;
};

type RequestOptions = RequestInit & { workspaceScoped?: boolean };

async function request<T>(path: string, options: RequestOptions = {}, authenticated = true): Promise<T> {
  const { workspaceScoped = true, ...fetchOptions } = options;
  const session = sessionStore.read();
  if (authenticated && workspaceScoped && !session?.activeWorkspaceId) throw new Error('请选择工作空间后再继续。');
  // Authorization and X-Workspace-Id are injected here.
}
```

`webAuth.login/register/me`、`webWorkspaces.list/create/rename/select` 显式传 `{ workspaceScoped: false }`。`projectFile()` 的手写 `fetch` 同样注入空间头。

- [ ] **Step 6: 更新 E2E Mock 会话和请求断言**

Python Mock 的登录与 `auth/me` 响应改为 `workspaces + activeWorkspaceId`；所有空间内请求必须断言：

```python
assert route.request.headers.get("x-workspace-id") == state["active_workspace_id"]
```

- [ ] **Step 7: 运行回归并提交**

Run: `npm test`

Expected: 全部 Node 测试通过。

Run: `npm run typecheck`

Expected: PASS。

```powershell
git add content-engine/server/index.cjs content-engine/src/domain/workspace.ts content-engine/src/data/sessionStore.ts content-engine/src/data/webApi.ts content-engine/src/data/localRepository.ts content-engine/tests
git commit -m "refactor: require explicit workspace requests"
```

### Task 4: 实现空间选择、创建、切换和重命名界面

**Files:**

- Create: `content-engine/src/components/workspace/WorkspaceSwitcher.tsx`
- Create: `content-engine/src/workspaces/settings/WorkspaceManagementSettings.tsx`
- Modify: `content-engine/src/workspaces/settings/WorkspaceProfileSettings.tsx:1-70`
- Modify: `content-engine/src/workspaces/SettingsWorkspace.tsx:1-40`
- Modify: `content-engine/src/main.tsx:50-285,668-683`
- Modify: `content-engine/src/styles.css`
- Create: `content-engine/tests/workspace-ui.test.mjs`

**Interfaces:**

- Consumes: `webWorkspaces.create/rename/select` 和 `sessionStore.write`。
- Produces: `WorkspaceSwitcher({ session, onSessionChange })`。
- Produces: `WorkspaceManagementSettings({ session, onSessionChange })`。

- [ ] **Step 1: 写空间 UI 失败测试**

```js
test('应用根节点按当前空间重新挂载并提供无空间门禁', () => {
  assert.match(main, /key=\{session\.activeWorkspaceId\}/);
  assert.match(main, /session\.activeWorkspaceId \? <App/);
  assert.match(main, /<WorkspaceGate/);
});

test('顶部和设置页使用同一组真实空间 API', () => {
  assert.match(switcher, /webWorkspaces\.select/);
  assert.match(settings, /webWorkspaces\.create/);
  assert.match(settings, /webWorkspaces\.rename/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/workspace-ui.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现根空间门禁和切换重挂载**

```tsx
function WebEntry() {
  const [session, setSession] = useState(webAuth.session());
  if (!session) return <WebAuthScreen onAuthenticated={setSession} />;
  if (!session.activeWorkspaceId) return <WorkspaceGate session={session} onSessionChange={setSession} />;
  return <App key={session.activeWorkspaceId} session={session} onSessionChange={setSession} />;
}
```

切换前禁用按钮并等待正在执行的显式保存队列完成；成功后写入新会话。根节点 `key` 变化负责销毁旧空间页面、项目选择、请求状态和 Blob URL，不手工维护第二套缓存清理逻辑。

- [ ] **Step 4: 实现顶部切换器**

切换器显示当前空间、所有活动空间和“管理工作空间”。不存在权限的空间不会进入客户端列表。移动端使用按钮打开菜单，不使用原生宽下拉破坏 390px 布局。

- [ ] **Step 5: 实现空间管理页**

支持创建、切换和重命名。创建成功后立即成为当前空间并重挂载应用。当前任务暂不放置不可工作的删除按钮；删除在 Task 8 完整接入影响预览和 Worker 后一次开放。

- [ ] **Step 6: 运行测试、类型检查和构建**

Run: `node --test tests/workspace-ui.test.mjs tests/web-navigation.test.mjs`

Expected: PASS。

Run: `npm run typecheck && npm run build`

Expected: PASS。

- [ ] **Step 7: 提交空间 UI**

```powershell
git add content-engine/src/components/workspace/WorkspaceSwitcher.tsx content-engine/src/workspaces/settings/WorkspaceManagementSettings.tsx content-engine/src/workspaces/settings/WorkspaceProfileSettings.tsx content-engine/src/workspaces/SettingsWorkspace.tsx content-engine/src/main.tsx content-engine/src/styles.css content-engine/tests/workspace-ui.test.mjs content-engine/tests/web-navigation.test.mjs
git commit -m "feat: add workspace switching"
```

### Task 5: 建立空间素材存储、领域服务和 API

**Files:**

- Create: `content-engine/server/services/assetStorage.cjs`
- Create: `content-engine/server/services/assets.cjs`
- Create: `content-engine/src/domain/assets.ts`
- Create: `content-engine/tests/assets.test.mjs`
- Modify: `content-engine/server/index.cjs:1000-1160`
- Modify: `content-engine/src/data/webApi.ts`

**Interfaces:**

- Produces: `saveUploadedAsset(root, workspaceId, part)`。
- Produces: `saveRemoteImageAsset(root, workspaceId, url, dependencies?)`。
- Produces: `openAsset(root, storageKey)`、`readAssetText(root, storageKey, maxBytes)`、`removeAssetFile(root, storageKey)`、`removeWorkspaceDirectory(root, workspaceId)`。
- Produces: `createAssetStore({ query, transaction })`。
- Produces: `webAssets.list/upload/import/update/content/link/unlink`。

- [ ] **Step 1: 写文件内容检测和去重失败测试**

```js
test('上传文件的声明 MIME 与内容不一致时拒绝保存', async () => {
  const part = filePart({ mimetype: 'image/png', content: Buffer.from('<html>') });
  await assert.rejects(() => saveUploadedAsset(root, 'workspace-a', part), /格式不一致/);
});

test('相同空间相同哈希复用已有素材', async () => {
  const store = createAssetStore(fakeAssetDb({ existingSha256: SHA }));
  const result = await store.createFromStoredFile('workspace-a', 'user-1', storedFile(SHA), { origin: 'UPLOAD', title: '重复图片' });
  assert.equal(result.created, false);
  assert.equal(result.asset.id, 'existing-asset');
});
```

- [ ] **Step 2: 写跨空间和项目复用失败测试**

```js
test('项目链接要求项目和素材属于同一空间', async () => {
  const store = createAssetStore(fakeAssetDb({ assetWorkspace: 'workspace-b' }));
  await assert.rejects(() => store.linkToProject('workspace-a', 'project-a', 'asset-b', linkInput), (error) => error.code === 'WORKSPACE_FORBIDDEN');
});

test('同一项目重复选择同一素材只保留一条关系', async () => {
  const store = createAssetStore(fakeAssetDb({ existingProjectLink: true }));
  const linked = await store.linkToProject('workspace-a', 'project-a', 'asset-a', linkInput);
  assert.equal(linked.linkId, 'existing-link');
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test tests/assets.test.mjs`

Expected: FAIL。

- [ ] **Step 4: 实现统一素材存储服务**

```js
async function saveUploadedAsset(root, workspaceId, part) {
  const temporaryKey = [workspaceId, 'assets', `${crypto.randomUUID()}.upload`].join('/');
  const temporaryPath = safePath(root, temporaryKey);
  const result = await streamAndHash(part.file, temporaryPath, 50 * 1024 * 1024);
  const detected = detectFileType(result.head, result.sample);
  if (!detected || detected.mimeType !== normalizeMime(part.mimetype)) {
    await fsp.rm(temporaryPath, { force: true });
    throw businessError(400, 'ASSET_FILE_INVALID', '文件内容与声明格式不一致。');
  }
  const storageKey = [workspaceId, 'assets', `${crypto.randomUUID()}${detected.extension}`].join('/');
  await fsp.rename(temporaryPath, safePath(root, storageKey));
  return { storageKey, originalFilename: part.filename, mimeType: detected.mimeType, kind: detected.kind, sizeBytes: result.sizeBytes, sha256: result.sha256 };
}
```

`detectFileType()` 明确识别 JPEG、PNG、WebP、GIF、PDF、UTF-8 文本/Markdown、MP3、WAV、M4A/MP4、WebM；无法识别或 MIME 冲突时拒绝。远程图片继续逐跳校验公开地址、15MB 上限和图片魔数。

- [ ] **Step 5: 实现素材 Store 和 DTO**

前端领域类型固定为：

```ts
export interface WorkspaceAsset {
  id: string;
  kind: 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO' | 'OTHER';
  origin: 'UPLOAD' | 'AI_GENERATED' | 'WEB_IMPORT';
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETING';
  title: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  sourceUrl: string | null;
  sourceNote: string;
  copyrightStatus: 'PENDING' | 'OWNED' | 'LICENSED' | 'OPEN_LICENSE' | 'PROHIBITED';
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAsset extends WorkspaceAsset {
  linkId: string;
  projectId: string;
  role: ProjectReferenceRole;
  scope: ProjectMaterialScope;
  platforms: CreativePlatform[];
  notes: string;
}
```

```js
function assetView(row) {
  return {
    id: row.id,
    kind: row.kind,
    origin: row.origin,
    status: row.status,
    title: row.title,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    sha256: row.sha256,
    sourceUrl: row.source_url ?? null,
    sourceNote: row.source_note,
    copyrightStatus: row.copyright_status,
    projectCount: Number(row.project_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
```

DTO 不包含 `storage_key`。`createFromStoredFile()` 在事务内按哈希锁定或插入；若复用已有素材，删除刚保存的重复物理文件。`linkToProject()` 使用跨空间复合外键并返回 `ProjectAsset`。

- [ ] **Step 6: 注册空间素材 API**

```js
app.get('/api/v1/assets', { preHandler: workspaceAccess.forRole('VIEWER') }, listAssets);
app.post('/api/v1/assets', { preHandler: workspaceAccess.forRole('EDITOR') }, uploadAsset);
app.post('/api/v1/assets/import', { preHandler: workspaceAccess.forRole('EDITOR') }, importAsset);
app.get('/api/v1/assets/:assetId', { preHandler: workspaceAccess.forRole('VIEWER') }, getAsset);
app.get('/api/v1/assets/:assetId/content', { preHandler: workspaceAccess.forRole('VIEWER') }, streamAsset);
app.patch('/api/v1/assets/:assetId', { preHandler: workspaceAccess.forRole('EDITOR') }, updateAsset);
app.post('/api/v1/projects/:projectId/assets/:assetId', { preHandler: workspaceAccess.forRole('EDITOR') }, linkAsset);
app.delete('/api/v1/projects/:projectId/assets/:assetId', { preHandler: workspaceAccess.forRole('EDITOR') }, unlinkAsset);
```

文件响应设置 `Cache-Control: private`、`X-Content-Type-Options: nosniff`、沙箱 CSP 和安全的 `Content-Disposition`。

- [ ] **Step 7: 运行测试并提交**

Run: `node --test tests/assets.test.mjs tests/project-materials.test.mjs`

Expected: PASS。

```powershell
git add content-engine/server/services/assetStorage.cjs content-engine/server/services/assets.cjs content-engine/server/index.cjs content-engine/src/domain/assets.ts content-engine/src/data/webApi.ts content-engine/tests/assets.test.mjs content-engine/tests/project-materials.test.mjs
git commit -m "feat: add workspace asset api"
```

### Task 6: 将项目资料、研究和配图切换到空间素材

**Files:**

- Modify: `content-engine/server/services/projectMaterials.cjs`
- Modify: `content-engine/server/services/visual-planning.cjs`
- Modify: `content-engine/server/index.cjs:864-1190,2320-2410`
- Modify: `content-engine/src/domain/creative.ts:66-100`
- Modify: `content-engine/src/domain/content.ts:160-190`
- Modify: `content-engine/src/domain/visual-plan.mjs:520-630`
- Modify: `content-engine/src/domain/visual-plan.d.mts`
- Modify: `content-engine/src/data/webApi.ts:70-135`
- Modify: `content-engine/src/workspaces/create/ProjectMaterials.tsx:1-195`
- Modify: `content-engine/src/workspaces/create/VisualWorkspace.tsx:1-500`
- Modify: `content-engine/scripts/recover-content-projects.cjs`
- Delete: `content-engine/server/services/projectUploadStorage.cjs`
- Modify: `content-engine/tests/project-materials.test.mjs`
- Modify: `content-engine/tests/project-research-agent.test.mjs`
- Modify: `content-engine/tests/visual-plan.test.mjs`
- Modify: `content-engine/tests/visual-planning.test.mjs`
- Modify: `content-engine/tests/delivery-workflow.test.mjs`
- Modify: `content-engine/tests/storage-boundaries.test.mjs`

**Interfaces:**

- Produces materials response: `{ inputs: ProjectInput[], references: ProjectReference[], assets: ProjectAsset[] }`。
- Produces visual fields: `CreativeVisualPlanItem.assetId`, `CreativeVisualReference.assetId`, `coverAssetId`, `assetIds`。
- Removes: `ProjectReference.sourceType = 'FILE'`、`webCreative.projectFile/uploadFile/importImage`。

- [ ] **Step 1: 把测试契约改为素材 ID 并确认失败**

```js
test('配图方案只保存空间素材 ID', () => {
  const plan = buildVisualPlan(article, 'WECHAT');
  assert.ok(plan.every((item) => 'assetId' in item));
  assert.ok(plan.every((item) => !('assetReferenceId' in item)));
});

test('项目资料把外链与文件素材分开返回', async () => {
  const result = await store.list('workspace-a', 'project-a');
  assert.deepEqual(Object.keys(result).sort(), ['assets', 'inputs', 'references']);
  assert.ok(result.references.every((item) => item.sourceType === 'LINK'));
});
```

Run: `node --test tests/project-materials.test.mjs tests/project-research-agent.test.mjs tests/visual-plan.test.mjs tests/visual-planning.test.mjs tests/delivery-workflow.test.mjs`

Expected: FAIL，旧字段仍存在。

- [ ] **Step 2: 修改领域类型和纯配图函数**

```ts
export interface CreativeVisualReference {
  assetId: string;
  uses: CreativeVisualReferenceUse[];
}

export interface CreativeVisualPlanItem {
  // existing semantic fields
  references: CreativeVisualReference[];
  assetId: string | null;
}

export interface CreativeVisualDelivery {
  planVersion: number;
  styleProfile: CreativeVisualStyleProfile;
  coverAssetId: string | null;
  assetIds: string[];
  plan: CreativeVisualPlanItem[];
}
```

所有 `build/resize/upgrade/merge` 纯函数只读写 `assetId`，不兼容读取旧字段；数据库迁移已负责转换。

- [ ] **Step 3: 修改项目资料 Store 和研究快照**

`projectMaterials.list()` 分别读取项目输入、外链和 `project_asset_links JOIN workspace_assets`。`researchSnapshot(workspaceId, projectId, inputIds, referenceIds, assetIds)` 分别验证三类 ID 数量，并为素材返回合并行：

```js
{
  id: link.id,
  asset_id: asset.id,
  source_type: 'ASSET',
  role: link.role,
  scope: link.scope,
  title: link.title,
  notes: link.notes,
  mime_type: asset.mime_type,
  storage_key: asset.storage_key,
  original_filename: asset.original_filename,
}
```

研究任务表写 `asset_link_id`，外链继续写 `reference_id`。

- [ ] **Step 4: 修改项目资料和配图 API**

- 项目资料文件上传改为先 `POST /assets`，再 `POST /projects/:projectId/assets/:assetId`。
- 网络选图改为 `POST /assets/import` 后建立项目链接。
- AI 生图成功后创建空间素材并建立当前项目链接，响应 `{ asset, projectAsset }`。
- 参考图生成读取 `assetIds`，通过项目链接和素材表校验归属与图片 MIME。
- 保存配图校验全部 `assetId` 已链接到当前项目，并用素材哈希防止同图重复占位。

- [ ] **Step 5: 修改项目资料和配图 UI**

`ProjectMaterials` 的文件区改为 `ProjectAsset[]`，删除动作只解除当前项目引用；全局删除只在素材库执行。`VisualWorkspace` 使用 `asset.id` 绑定，项目素材、搜索导入和 AI 生图最终都进入同一 `ProjectAsset` 列表。

- [ ] **Step 6: 删除旧项目文件服务和所有旧字段**

Run: `rg -n "projectUploadStorage|assetReferenceId|coverReferenceId|assetReferenceIds|sourceType === 'FILE'|project-files|projectFile\(|uploadFile\(|importImage\(" server src scripts`

Expected: 无输出。

同步修改恢复脚本，只创建 `workspace_assets`、`project_asset_links` 和项目 JSON 的素材 ID；默认仍为预演，目标空间已有数据时拒绝覆盖。

- [ ] **Step 7: 运行定向和全量测试**

Run: `node --test tests/project-materials.test.mjs tests/project-research-agent.test.mjs tests/visual-plan.test.mjs tests/visual-planning.test.mjs tests/delivery-workflow.test.mjs tests/storage-boundaries.test.mjs`

Expected: PASS。

Run: `npm test && npm run typecheck && npm run build`

Expected: PASS。

- [ ] **Step 8: 提交素材切换**

```powershell
git add content-engine/server content-engine/src content-engine/scripts/recover-content-projects.cjs content-engine/tests
git commit -m "refactor: move project files to workspace assets"
```

### Task 7: 实现真实全局素材库、统一预览和项目复用

**Files:**

- Create: `content-engine/src/components/assets/AssetPreviewDialog.tsx`
- Create: `content-engine/src/components/assets/AssetPickerDialog.tsx`
- Create: `content-engine/src/workspaces/assets/AssetLibrary.tsx`
- Create: `content-engine/tests/asset-library-ui.test.mjs`
- Modify: `content-engine/src/workspaces/create/ProjectMaterials.tsx`
- Modify: `content-engine/src/workspaces/create/VisualWorkspace.tsx`
- Modify: `content-engine/src/main.tsx:247-265`
- Modify: `content-engine/src/styles.css`

**Interfaces:**

- Produces: `AssetPreviewDialog({ asset, onClose })`。
- Produces: `AssetPickerDialog({ projectId, role, scope, platforms, onLinked, onClose })`。
- Produces: `AssetLibrary()`。

- [ ] **Step 1: 写 UI 契约失败测试**

```js
test('素材库不是占位页并提供上传、预览和引用信息', () => {
  assert.doesNotMatch(main, /Utility title="素材库"/);
  assert.match(main, /<AssetLibrary/);
  assert.match(library, /webAssets\.list/);
  assert.match(library, /webAssets\.upload/);
  assert.match(library, /projectCount/);
  assert.match(library, /AssetPreviewDialog/);
});

test('项目资料和配图复用同一个预览组件', () => {
  assert.match(projectMaterials, /AssetPreviewDialog/);
  assert.match(visualWorkspace, /AssetPreviewDialog/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/asset-library-ui.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现鉴权 Blob 预览组件**

```tsx
useEffect(() => {
  let active = true;
  let objectUrl = '';
  void webAssets.content(asset.id).then((blob) => {
    if (!active) return;
    objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
  }).catch((reason) => active && setError(displayError(reason, '素材预览失败。')));
  return () => {
    active = false;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}, [asset.id]);
```

图片显示大图；PDF 使用受限 `iframe`；音视频使用原生控件；其它文件提供鉴权下载。加载失败显示错误和重试，不展示破图为成功。

- [ ] **Step 4: 实现素材库页面**

页面包含上传、类型、来源、版权状态、项目引用数和时间筛选。素材卡点击打开预览；编辑只修改标题、来源说明、版权状态和归档状态。永久删除在 Task 8 的可靠删除链路完成后才开放，本任务不放置不可工作的删除按钮。

- [ ] **Step 5: 实现项目素材选择器**

选择器读取空间 `ACTIVE` 素材，隐藏已链接项；选择后调用 `link()`，不复制文件。项目文件区提供“从素材库选择”和“上传新素材”，上传完成后自动建立项目引用。

- [ ] **Step 6: 在配图页复用预览和选择器**

已有素材、网图导入和 AI 生图都使用 `AssetPreviewDialog`。采用前点击缩略图打开大图；采用后“已绑定”卡仍能打开同一预览。

- [ ] **Step 7: 运行测试、构建并提交**

Run: `node --test tests/asset-library-ui.test.mjs tests/project-materials.test.mjs tests/delivery-workflow.test.mjs`

Expected: PASS。

Run: `npm run typecheck && npm run build`

Expected: PASS。

```powershell
git add content-engine/src/components/assets content-engine/src/workspaces/assets content-engine/src/workspaces/create/ProjectMaterials.tsx content-engine/src/workspaces/create/VisualWorkspace.tsx content-engine/src/main.tsx content-engine/src/styles.css content-engine/tests/asset-library-ui.test.mjs
git commit -m "feat: add reusable asset library"
```

### Task 8: 实现可靠素材删除与工作空间删除

**Files:**

- Create: `content-engine/server/services/storageDeletion.cjs`
- Modify: `content-engine/server/services/assets.cjs`
- Modify: `content-engine/server/services/workspaces.cjs`
- Modify: `content-engine/server/config.cjs`
- Modify: `content-engine/server/index.cjs`
- Modify: `content-engine/server/worker.cjs:35-75,969-970`
- Modify: `content-engine/src/data/webApi.ts`
- Modify: `content-engine/src/workspaces/assets/AssetLibrary.tsx`
- Modify: `content-engine/src/workspaces/settings/WorkspaceManagementSettings.tsx`
- Create: `content-engine/tests/storage-deletion.test.mjs`
- Modify: `content-engine/tests/workspaces.test.mjs`
- Modify: `content-engine/tests/assets.test.mjs`

**Interfaces:**

- Produces: `createStorageDeletionService({ query, transaction, uploadRoot })`。
- Produces: `claimDeletionJob(id)`、`markDeletionFailed(id, error)`、`recoverPendingDeletionJobs()`。
- Produces: `workspaceStore.deletionImpact(userId, workspaceId)`。
- Produces: `workspaceStore.requestDeletion(userId, workspaceId, confirmationName)`。
- Produces: `webWorkspaces.deletionImpact/remove`。

- [ ] **Step 1: 写删除状态机失败测试**

```js
test('空间删除影响预览返回所有领域数量', async () => {
  const impact = await store.deletionImpact('owner-1', 'workspace-a');
  assert.deepEqual(impact, {
    projects: 8,
    assets: 33,
    channelAccounts: 0,
    publications: 0,
    metricSnapshots: 0,
    retrospectives: 0,
  });
});

test('名称不匹配时不标记空间删除', async () => {
  await assert.rejects(() => store.requestDeletion('owner-1', 'workspace-a', '错误名称'), (error) => error.code === 'WORKSPACE_DELETE_CONFIRMATION_MISMATCH');
});

test('存储删除任务成功后才删除数据库主体', async () => {
  const service = createStorageDeletionService(dependencies);
  await service.execute(job);
  assert.deepEqual(calls.map(({ action }) => action), ['remove-files', 'complete-job', 'delete-workspace']);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/storage-deletion.test.mjs tests/workspaces.test.mjs tests/assets.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现影响预览和删除请求事务**

`server/config.cjs` 增加：

```js
workspaceDeletionEnabled: process.env.NODE_ENV !== 'production'
  || process.env.WORKSPACE_DELETE_ENABLED === 'true',
```

生产环境未明确设置开关时，影响预览可用但永久删除返回 `503 WORKSPACE_DELETE_DISABLED`。部署人员只有在最近一次备份完成且 SHA-256 可验证后才能开启该环境变量。

`deletionImpact()` 使用同一事务快照统计正式表。`requestDeletion()` 先锁定空间和 OWNER 成员，比较完整名称，再执行：

阶段 C 的账号、发布、指标和复盘表在本阶段尚不存在。影响预览通过 `to_regclass()` 判断表是否存在：不存在时返回 `0`，存在后执行带 `workspace_id` 的参数化计数；禁止直接拼接用户输入的表名。

```sql
UPDATE workspaces SET status = 'DELETING', updated_at = now()
WHERE id = $1 AND status = 'ACTIVE';

INSERT INTO storage_deletion_jobs
  (workspace_id, target_type, target_id, storage_key, status, requested_by)
VALUES ($1, 'WORKSPACE', $1, $2, 'PENDING', $3);

INSERT INTO jobs (workspace_id, job_type, payload_json)
VALUES ($1, 'STORAGE_DELETE', jsonb_build_object('deletionJobId', $4));
```

提交后调用现有 `enqueue()`；入队失败时数据库任务保持 `PENDING`，管理页显示重试，不把空间恢复为活动状态。

- [ ] **Step 4: 实现物理删除执行器**

```js
async function execute(job, queueJobId) {
  const claimed = await claimDeletionJob(job.id);
  if (!claimed) return { skipped: true };
  try {
    if (job.target_type === 'ASSET' || job.target_type === 'ORPHAN_FILE') await removeAssetFile(uploadRoot, job.storage_key);
    if (job.target_type === 'WORKSPACE') await removeWorkspaceDirectory(uploadRoot, job.workspace_id);
    await transaction(async (client) => {
      if (job.target_type === 'ASSET') await client.query('DELETE FROM workspace_assets WHERE workspace_id = $1 AND id = $2 AND status = $3', [job.workspace_id, job.target_id, 'DELETING']);
      await client.query("UPDATE storage_deletion_jobs SET status = 'SUCCEEDED', completed_at = now() WHERE id = $1", [job.id]);
      await client.query("UPDATE jobs SET status = 'SUCCEEDED', result_json = $2, completed_at = now() WHERE id = $1", [queueJobId, JSON.stringify({ deletionJobId: job.id })]);
      if (job.target_type === 'WORKSPACE') await client.query('DELETE FROM workspaces WHERE id = $1 AND status = $2', [job.workspace_id, 'DELETING']);
    });
  } catch (error) {
    await markDeletionFailed(job.id, error);
    throw error;
  }
}
```

`safePath()` 必须验证待删路径恰好位于 `uploadRoot/<workspaceId>` 或指定素材键内，拒绝根目录、空值、`..` 和其它空间路径。

Worker 启动时查询 `storage_deletion_jobs.status = 'PENDING'`，为尚无活动 `jobs` 记录的删除任务创建 `STORAGE_DELETE` Job 并调用现有 `enqueue()`。这既恢复普通删除失败后的任务，也清理迁移产生的 `ORPHAN_FILE`；同一目标的活动唯一索引保证不会重复删除。

- [ ] **Step 5: 接入 Worker 和删除 API**

`processJob()` 在模型任务之前处理：

```js
if (queueJob.name === 'STORAGE_DELETE') {
  return storageDeletion.executeById({ workspaceId, deletionJobId: payload.deletionJobId, queueJobId: jobId });
}
```

新增：

```js
app.get('/api/v1/workspaces/:workspaceId/deletion-impact', { preHandler: authenticate }, impactHandler);
app.delete('/api/v1/workspaces/:workspaceId', { preHandler: authenticate }, deleteHandler);
app.delete('/api/v1/assets/:assetId', { preHandler: workspaceAccess.forRole('EDITOR') }, requestAssetDeletion);
```

删除空间管理接口按路径校验 OWNER，不要求当前空间头，确保当前空间已经不可读时仍能查询删除状态。

- [ ] **Step 6: 实现删除确认 UI**

空间管理页先读取影响预览，展示六类数量，要求输入完整空间名。删除当前空间后，从会话移除该空间；若仍有空间，显示选择页而不是自动跳到另一个空间；若无空间，显示创建页。

素材库删除显示项目引用冲突。没有引用时提交删除并从列表移除；失败任务显示“删除失败”和重试，不恢复素材可编辑状态。

- [ ] **Step 7: 运行测试并提交**

Run: `node --test tests/storage-deletion.test.mjs tests/workspaces.test.mjs tests/assets.test.mjs tests/workspace-ui.test.mjs tests/asset-library-ui.test.mjs`

Expected: PASS。

Run: `npm run typecheck && npm run build`

Expected: PASS。

```powershell
git add content-engine/server/services/storageDeletion.cjs content-engine/server/services/assets.cjs content-engine/server/services/workspaces.cjs content-engine/server/index.cjs content-engine/server/worker.cjs content-engine/src/data/webApi.ts content-engine/src/workspaces/assets/AssetLibrary.tsx content-engine/src/workspaces/settings/WorkspaceManagementSettings.tsx content-engine/tests
git commit -m "feat: add safe workspace deletion"
```

### Task 9: 真实迁移、端到端验收和文档收口

**Files:**

- Create: `content-engine/tests/workspace-assets.e2e.py`
- Modify: `content-engine/tests/creative-workspace.e2e.py`
- Modify: `content-engine/tests/visual-workspace.e2e.py`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`

**Interfaces:**

- Consumes: Tasks 1-8 的全部 API、UI 和迁移。
- Produces: 可重复的多空间与素材 E2E、真实数据库迁移对账和完成记录。

- [ ] **Step 1: 写多空间与素材 E2E**

测试使用真实前端和 Mock API，覆盖：

```python
def test_workspace_and_asset_flow(page):
    register(page)
    create_workspace(page, "客户 B")
    switch_workspace(page, "个人账号")
    upload_asset(page, SAMPLE_PNG)
    link_asset_to_two_projects(page)
    preview_asset(page)
    unlink_first_project(page)
    assert_second_project_preview_still_visible(page)
    switch_workspace(page, "客户 B")
    assert_asset_library_empty(page)
    reload_and_assert_workspace_restored(page, "客户 B")
```

另覆盖 390px 空间切换器、素材库、预览弹窗和删除确认无横向溢出。

- [ ] **Step 2: 运行 E2E 确认失败**

Run: `python tests/workspace-assets.e2e.py`

Expected: 在未启动 Web 时明确失败；使用启动包装后进入完整验证。

- [ ] **Step 3: 生成迁移前备份并记录校验值**

在 `F:\zimeitiyunying` 执行只读统计和备份，备份路径使用新的时间戳目录，不覆盖事故备份：

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupDir = "F:\zimeitiyunying\backups\workspace-assets-$stamp"
New-Item -ItemType Directory -Path $backupDir | Out-Null
docker exec content-engine-postgres pg_dump -U postgres -Fc content_engine > "$backupDir\content-engine.dump"
Get-FileHash -Algorithm SHA256 "$backupDir\content-engine.dump"
```

迁移前记录：空间数、项目数、旧文件参考数、文件大小总和、每个文件 SHA-256、配图绑定数。

- [ ] **Step 4: 应用迁移并执行数据库对账**

Run: `npm run db:migrate`

Expected: 应用 `027_workspace_asset_foundation.sql`，无错误。

对账 SQL 必须证明：

```sql
SELECT count(*) FROM content_projects;                 -- 8
SELECT count(*) FROM workspace_assets;                 -- 33
SELECT count(*) FROM project_asset_links;              -- 原文件项目关系数
SELECT count(*) FROM content_projects
WHERE project_json::text LIKE '%assetReferenceId%';    -- 0
SELECT count(*) FROM project_references
WHERE source_type <> 'LINK';                           -- 0
```

再逐素材读取物理文件，验证 `size_bytes` 和 SHA-256；统计项目 JSON 中非空 `assetId` 为 29，且全部能关联到当前空间素材。

- [ ] **Step 5: 运行完整自动化**

Run: `npm test`

Expected: 现有测试和新增测试全部通过，失败数 0。

Run: `npm run typecheck`

Expected: PASS。

Run: `npm run build`

Expected: PASS。

Run: `python C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py --server "npm run dev:web" --port 5173 -- python tests/workspace-assets.e2e.py`

Expected: PASS。

Run: `python C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py --server "npm run dev:web" --port 5173 -- python tests/creative-workspace.e2e.py`

Expected: PASS。

Run: `python C:\Users\Administrator\.agents\skills\webapp-testing\scripts\with_server.py --server "npm run dev:web" --port 5173 -- python tests/visual-workspace.e2e.py`

Expected: PASS。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 6: 真实浏览器验收**

启动 API、Web、Worker 后使用现有真实账号验证：

1. 登录后显示恢复的数据空间和 8 个项目。
2. 创建第二空间并切换，第二空间项目、素材、资讯和模型设置均为空。
3. 返回原空间，8 个项目、33 份素材和 29 个配图绑定仍存在。
4. 上传一张新图，两个项目复用；解除一个项目引用后另一个项目仍可预览。
5. 网图、AI 生图和素材库图片采用前后均可打开大图预览。
6. 网络面板中所有空间内请求携带正确 `X-Workspace-Id`，无跨空间响应、无失败写请求。
7. 390px 页面无横向溢出，控制台无未处理异常。

- [ ] **Step 7: 更新实施记录**

只在 Step 3-6 全部通过后更新两份文档，明确写出：

- 已实现功能；
- 自动化测试数量和结果；
- 真实迁移前后数量与哈希；
- 真实浏览器验收结果；
- 仍未实现的阶段 B、C，不写成已完成。

- [ ] **Step 8: 最终提交和推送**

```powershell
git add content-engine/tests/workspace-assets.e2e.py content-engine/tests/creative-workspace.e2e.py content-engine/tests/visual-workspace.e2e.py docs/02_PLAN_内容引擎.md docs/03_IMPLEMENT_内容引擎.md
git commit -m "test: verify workspace asset foundation"
git push origin main
```

最终再次运行：

Run: `git status --short`

Expected: 无输出。

Run: `git rev-parse HEAD; git rev-parse origin/main`

Expected: 两个提交 ID 完全一致。

---

## Plan Self-Review Checklist

- [x] 规格第 5 节“用户、会话与工作空间”由 Tasks 1-4、8 覆盖。
- [x] 规格第 6 节“空间级素材库”由 Tasks 1、5-8 覆盖。
- [x] 规格第 10 节阶段 A 数据模型由 Task 1 覆盖。
- [x] 规格第 11.1、11.2 API 由 Tasks 2、3、5、8 覆盖。
- [x] 规格第 12.1、12.2 前端由 Tasks 4、7、8 覆盖。
- [x] 规格第 13 节错误处理与安全由 Tasks 2、3、5、8 覆盖。
- [x] 规格第 14 节迁移由 Tasks 1、6、9 覆盖。
- [x] 规格第 15.2 阶段 A 验收由 Task 9 覆盖。
- [x] 不含占位标记、跨任务省略说明或未定义接口。
- [x] `assetId`、`coverAssetId`、`assetIds`、`CreativeVisualReference.assetId` 命名在迁移、服务端、前端和测试中一致。
- [x] `WorkspaceSummary`、`WebSession`、`request.workspace` 命名在服务端和前端一致。
