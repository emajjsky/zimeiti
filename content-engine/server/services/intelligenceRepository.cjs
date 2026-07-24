const { query, transaction } = require('../db.cjs');
const { refreshRss } = require('./rss.cjs');

function sourceDto(row) {
  return { id: row.id, name: row.name, type: 'RSS', url: row.url, category: row.category, includeKeywords: row.include_keywords ?? [], excludeKeywords: row.exclude_keywords ?? [], language: row.language, enabled: row.enabled, refreshMinutes: row.refresh_minutes, trust: row.trust, lastSyncedAt: row.last_synced_at?.toISOString?.() ?? row.last_synced_at ?? undefined, lastError: row.last_error ?? undefined };
}

function itemDto(row) {
  return { id: row.id, title: row.title, summary: row.summary, category: row.category, source: row.source_name, publishedAt: row.published_at?.toISOString?.() ?? row.published_at ?? row.created_at?.toISOString?.() ?? new Date().toISOString(), heat: row.heat, trust: row.trust, url: row.canonical_url ?? undefined, captureMethod: row.capture_method, language: row.language, note: row.note ?? undefined };
}

async function listSources(workspaceId) {
  const result = await query('SELECT * FROM intelligence_sources WHERE workspace_id = $1 ORDER BY created_at ASC', [workspaceId]);
  return result.rows.map(sourceDto);
}

async function createSources(workspaceId, sources) {
  return transaction(async (client) => {
    const saved = [];
    for (const source of sources) {
      const existing = await client.query('SELECT * FROM intelligence_sources WHERE workspace_id = $1 AND url = $2', [workspaceId, source.url.trim()]);
      if (existing.rowCount) { saved.push(sourceDto(existing.rows[0])); continue; }
      const result = await client.query(`INSERT INTO intelligence_sources (workspace_id, name, source_type, url, category, include_keywords, exclude_keywords, language, enabled, refresh_minutes, trust)
        VALUES ($1, $2, 'RSS', $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [workspaceId, source.name.trim() || '未命名 RSS 源', source.url.trim(), source.category.trim() || '未分类', JSON.stringify(source.includeKeywords ?? []), JSON.stringify(source.excludeKeywords ?? []), source.language ?? 'ALL', source.enabled !== false, Math.max(5, Number(source.refreshMinutes) || 60), source.trust || '待核验']);
      saved.push(sourceDto(result.rows[0]));
    }
    return saved;
  });
}

async function removeSource(workspaceId, sourceId) {
  const result = await query('DELETE FROM intelligence_sources WHERE id = $1 AND workspace_id = $2 RETURNING id', [sourceId, workspaceId]);
  if (!result.rowCount) throw new Error('未找到资讯来源。');
}

async function listItems(workspaceId) {
  const result = await query('SELECT * FROM intelligence_items WHERE workspace_id = $1 ORDER BY COALESCE(published_at, created_at) DESC LIMIT 500', [workspaceId]);
  return result.rows.map(itemDto);
}

async function refreshWorkspaceRss(workspaceId) {
  const sources = await listSources(workspaceId);
  const collected = await refreshRss(sources);
  const savedItems = [];
  await transaction(async (client) => {
    for (const item of collected.items) {
      const source = sources.find((candidate) => candidate.id === item.sourceId);
      if (!source) continue;
      const sourceKey = item.url ? `url:${item.url}` : `title:${normalize(item.title)}`;
      const result = await client.query(`INSERT INTO intelligence_items (workspace_id, source_id, source_key, title, summary, category, source_name, canonical_url, language, capture_method, trust, heat, published_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'RSS', $10, $11, $12)
        ON CONFLICT (workspace_id, source_id, source_key) WHERE source_key IS NOT NULL DO UPDATE SET title = excluded.title, summary = excluded.summary, category = excluded.category, canonical_url = excluded.canonical_url, language = excluded.language, trust = excluded.trust, published_at = excluded.published_at
        RETURNING *`, [workspaceId, source.id, sourceKey, item.title, item.summary, item.category, item.source, item.url ?? null, item.language ?? 'other', item.trust, item.heat ?? 0, item.publishedAt ? new Date(item.publishedAt) : null]);
      savedItems.push(itemDto(result.rows[0]));
    }
    for (const status of collected.results) await client.query('UPDATE intelligence_sources SET last_synced_at = CASE WHEN $1 THEN now() ELSE last_synced_at END, last_error = CASE WHEN $1 THEN NULL ELSE $2 END WHERE id = $3 AND workspace_id = $4', [status.ok, status.error ?? null, status.sourceId, workspaceId]);
  });
  return { items: savedItems, results: collected.results, sources: await listSources(workspaceId) };
}

function normalize(value) { return String(value).replace(/\s+/g, ' ').trim().toLowerCase(); }

module.exports = { listSources, createSources, removeSource, listItems, refreshWorkspaceRss };
