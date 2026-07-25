# Intelligence Source Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩充合规热点来源，并让每篇文章拥有可筛选的统一题材和真实命中关键词。

**Architecture:** 使用共享 JSON 保存题材规则和来源目录，服务端 CJS 分类器负责 RSS 文章级分类，PostgreSQL 保存关键词并按规范化原文 URL 全局去重。Web 端读取同一来源目录，分开呈现自动来源和辅助渠道，热点页增加关键词筛选。

**Tech Stack:** React、TypeScript、Fastify、Node.js CommonJS、PostgreSQL 16、`node:test`、Vite、现有原生 CSS。

## Global Constraints

- 微博、今日头条、央视网、X、公众号不做未授权定时抓取。
- Playwright 本轮只预留 `BROWSER_ASSISTED` 设计边界，不进入定时采集实现。
- 题材固定为 `AI`、`科技`、`财经`、`体育`、`娱乐`、`社会`、`国际`、`时政`、`文化`、`教育`、`健康`、`汽车`、`其它`。
- 分类规则先使用确定性规则引擎，不调用大模型。
- 近 30 天保留策略、来源级刷新错误和用户确认入库规则不得回退。
- 前端保持现有波普怀旧清新视觉，不增加冗余说明卡。

---

### Task 1: 共享题材规则与文章分类器

**Files:**
- Create: `content-engine/shared/intelligence-taxonomy.json`
- Create: `content-engine/server/services/intelligenceClassifier.cjs`
- Create: `content-engine/tests/intelligence-classifier.test.mjs`

**Interfaces:**
- Consumes: `{ title: string, summary?: string, fallbackCategory?: string }`
- Produces: `classifyIntelligence(input): { category: string, keywords: string[] }`

- [ ] **Step 1: Write the failing classifier tests**

```js
test('按文章内容识别体育而不是来源默认题材', () => {
  const result = classifyIntelligence({
    title: '中国男篮国际比赛首战获胜',
    summary: '球队在篮球邀请赛中夺得开门红',
    fallbackCategory: '时事',
  });
  assert.equal(result.category, '体育');
  assert.ok(result.keywords.includes('篮球'));
});

test('无规则命中时回退来源默认题材', () => {
  assert.deepEqual(classifyIntelligence({ title: '今日简报', fallbackCategory: '社会' }), {
    category: '社会',
    keywords: [],
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/intelligence-classifier.test.mjs`

Expected: FAIL because `intelligenceClassifier.cjs` does not exist.

- [ ] **Step 3: Create the taxonomy JSON**

Use the complete 13-category rule set below. Category order is also the stable tie-break order:

```json
{
  "categories": [
    { "id": "AI", "keywords": ["人工智能", "大模型", "生成式AI", "智能体", "机器学习", "深度学习", "OpenAI", "Claude", "Qwen", "通义千问", "ChatGPT", "Gemini"] },
    { "id": "科技", "keywords": ["科技", "芯片", "半导体", "机器人", "操作系统", "云计算", "量子计算", "航天", "卫星", "Apple", "Microsoft", "Google", "NVIDIA"] },
    { "id": "财经", "keywords": ["财经", "金融", "股市", "A股", "港股", "美股", "基金", "债券", "央行", "利率", "汇率", "财报", "IPO", "证券"] },
    { "id": "体育", "keywords": ["体育", "足球", "篮球", "乒乓球", "羽毛球", "网球", "奥运", "联赛", "冠军", "世界杯", "全运会"] },
    { "id": "娱乐", "keywords": ["娱乐", "电影", "电视剧", "综艺", "票房", "演员", "导演", "音乐", "演唱会", "明星", "短剧", "影视"] },
    { "id": "社会", "keywords": ["社会", "民生", "交通", "天气", "事故", "救援", "社区", "就业", "养老", "住房", "消费维权", "公共安全"] },
    { "id": "国际", "keywords": ["国际", "联合国", "外交", "峰会", "制裁", "停火", "战争", "白宫", "欧盟", "北约", "地缘政治", "global"] },
    { "id": "时政", "keywords": ["时政", "国务院", "人大", "政协", "政策", "条例", "部委", "政府工作报告", "新闻发布会", "行政法规", "改革方案"] },
    { "id": "文化", "keywords": ["文化", "文学", "历史", "文物", "考古", "非遗", "博物馆", "国学", "传统文化", "艺术展", "戏曲", "出版"] },
    { "id": "教育", "keywords": ["教育", "学校", "高校", "大学", "中小学", "高考", "考研", "招生", "教师", "课程", "留学", "职业教育"] },
    { "id": "健康", "keywords": ["健康", "医疗", "医院", "医生", "疾病", "药品", "疫苗", "养生", "医保", "临床", "公共卫生", "心理健康"] },
    { "id": "汽车", "keywords": ["汽车", "新能源车", "电动车", "自动驾驶", "车企", "车型", "销量", "充电桩", "比亚迪", "特斯拉", "小米汽车", "智能驾驶"] },
    { "id": "其它", "keywords": [] }
  ]
}
```

Do not add generic keywords such as “中国” or “发展” that would dominate unrelated articles.

- [ ] **Step 4: Implement the classifier**

```js
function classifyIntelligence({ title = '', summary = '', fallbackCategory = '其它' }) {
  const titleText = normalize(title);
  const summaryText = normalize(summary);
  const scores = taxonomy.categories.map((category, order) => {
    const matched = category.keywords.filter((keyword) => includesTerm(titleText, summaryText, keyword));
    const score = matched.reduce((total, keyword) => total + (includes(titleText, keyword) ? 3 : 1), 0);
    return { category: category.id, matched, score, order };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score || left.order - right.order);
  return scores[0]
    ? { category: scores[0].category, keywords: scores[0].matched.slice(0, 5) }
    : { category: allowedCategory(fallbackCategory), keywords: [] };
}
```

Handle the standalone English token `AI` with word boundaries so it does not match words such as `said`.

- [ ] **Step 5: Run classifier tests**

Run: `node --test tests/intelligence-classifier.test.mjs`

Expected: all classifier cases pass for AI、科技、财经、体育、娱乐、社会、国际、时政、文化、教育、健康、汽车 and fallback.

- [ ] **Step 6: Commit**

```powershell
git add content-engine/shared/intelligence-taxonomy.json content-engine/server/services/intelligenceClassifier.cjs content-engine/tests/intelligence-classifier.test.mjs
git commit -m "add deterministic intelligence classifier"
```

### Task 2: RSS 分类、关键词持久化与跨来源去重

**Files:**
- Create: `content-engine/server/migrations/006_intelligence_keywords.sql`
- Create: `content-engine/server/services/urlNormalizer.cjs`
- Modify: `content-engine/server/services/rss.cjs`
- Modify: `content-engine/server/services/intelligenceRepository.cjs`
- Modify: `content-engine/server/services/public-web.cjs`
- Modify: `content-engine/server/services/tavily.cjs`
- Modify: `content-engine/src/domain/content.ts`
- Modify: `content-engine/src/vite-env.d.ts`
- Modify: `content-engine/src/main.tsx`
- Modify: `content-engine/tests/intelligence-classifier.test.mjs`

**Interfaces:**
- Consumes: Task 1 `classifyIntelligence()`
- Produces: `IntelligenceItem.keywords?: string[]` and database `matched_keywords jsonb`

- [ ] **Step 1: Add failing RSS and DTO tests**

```js
test('RSS item uses article classification and exposes matched keywords', async () => {
  const item = await collectRssEntryForTest({
    source: { category: '时事' },
    entry: { title: '足球联赛决赛落幕', description: '冠军球队完成逆转' },
  });
  assert.equal(item.category, '体育');
  assert.ok(item.keywords.includes('足球'));
});

test('repository DTO returns matched keywords', () => {
  assert.deepEqual(itemDto({ matched_keywords: ['芯片'] }).keywords, ['芯片']);
});

test('规范化 URL 去除追踪参数、片段并稳定排序查询参数', () => {
  assert.equal(
    normalizeCanonicalUrl('https://example.com/a?utm_source=x&b=2&a=1#section'),
    'https://example.com/a?a=1&b=2',
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/intelligence-classifier.test.mjs`

Expected: FAIL because RSS does not classify entries and DTO does not expose keywords.

- [ ] **Step 3: Add migration 006**

```sql
ALTER TABLE intelligence_items
  ADD COLUMN matched_keywords jsonb NOT NULL DEFAULT '[]'::jsonb;

WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY workspace_id, canonical_url
    ORDER BY created_at DESC, id DESC
  ) AS position
  FROM intelligence_items
  WHERE canonical_url IS NOT NULL
)
DELETE FROM intelligence_items
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

CREATE UNIQUE INDEX intelligence_items_workspace_url_idx
  ON intelligence_items (workspace_id, canonical_url)
  WHERE canonical_url IS NOT NULL;
```

The SQL migration adds the column, deterministically removes existing exact-URL duplicates and creates the index. New and refreshed rows store normalized URLs before writing. `normalizeCanonicalUrl()` removes the fragment, lowercases host, removes default ports, removes `utm_*`, `spm`, `from`, `source`, `ref`, `ref_src`, `fbclid`, `gclid` and `share_token`, then sorts remaining query parameters by key and value. Invalid or absent URLs return `null`. Existing non-duplicate historical rows are normalized opportunistically on their next refresh; do not implement URL parsing with SQL string manipulation.

- [ ] **Step 4: Apply article classification in RSS parsing**

Call `classifyIntelligence({ title, summary, fallbackCategory: source.category })` for each entry. Return `category` and `keywords` from its result. Export a focused entry conversion helper for unit testing without network calls.

- [ ] **Step 5: Persist and return keywords**

Update `itemDto()` to return `keywords: row.matched_keywords ?? []`. For rows with a URL, upsert against `intelligence_items_workspace_url_idx`; update source, title, summary, category, keywords, language and published time. Keep the existing `source_key` path only for entries without URLs.

- [ ] **Step 6: Classify link clips and Tavily results**

`clipPublicLink()` and `searchTavily()` call `classifyIntelligence()` with the extracted title and summary. Both return `category` and `keywords`; Tavily uses the submitted category only as `fallbackCategory`. Extend `webApi.ts`, `vite-env.d.ts`, `LinkClipEditor` preview assignment and `IntelligenceItem` so these values survive from server response to the saved hotspot.

- [ ] **Step 7: Update the frontend domain type**

```ts
export interface IntelligenceItem {
  // existing fields
  keywords?: string[];
}
```

- [ ] **Step 8: Run unit and database verification**

Run:

```powershell
npm test
npm run db:migrate
```

Expected: tests pass and migration `006_intelligence_keywords.sql` is recorded once.

- [ ] **Step 9: Commit**

```powershell
git add content-engine/server/migrations/006_intelligence_keywords.sql content-engine/server/services/urlNormalizer.cjs content-engine/server/services/rss.cjs content-engine/server/services/intelligenceRepository.cjs content-engine/server/services/public-web.cjs content-engine/server/services/tavily.cjs content-engine/src/domain/content.ts content-engine/src/vite-env.d.ts content-engine/src/main.tsx content-engine/tests/intelligence-classifier.test.mjs
git commit -m "persist intelligence categories and keywords"
```

### Task 3: 合规来源目录

**Files:**
- Create: `content-engine/shared/intelligence-sources.json`
- Create: `content-engine/src/data/intelligenceSources.ts`
- Create: `content-engine/tests/intelligence-sources.test.mjs`
- Modify: `content-engine/src/main.tsx`

**Interfaces:**
- Produces: `automaticSourceGroups`, `assistedChannels`, `intelligenceCategories`
- Automatic source entry matches `Omit<IntelligenceSource, 'id' | 'lastSyncedAt' | 'lastError'>`
- Assisted channel shape: `{ id, label, domains: string[], supportsClip: boolean, supportsSearch: boolean }`

- [ ] **Step 1: Write failing catalog tests**

```js
test('automatic source URLs are unique and cover at least eight categories', () => {
  const urls = catalog.automatic.flatMap((group) => group.sources.map((source) => source.url));
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(new Set(catalog.automatic.flatMap((group) => group.sources.map((source) => source.category))).size >= 8);
});

test('assisted channels include the five compliant entries', () => {
  assert.deepEqual(catalog.assisted.map((item) => item.id), ['WEIBO', 'TOUTIAO', 'CCTV', 'X', 'WECHAT']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/intelligence-sources.test.mjs`

Expected: FAIL because the catalog file does not exist.

- [ ] **Step 3: Create the verified source catalog**

Use this complete catalog. The six China News feeds were verified as HTTP 200 XML on 2026-07-25; `cul.xml` is excluded because it returned 404:

```json
{
  "automatic": [
    { "id": "domestic-mainstream", "label": "国内综合", "sources": [
      { "name": "中国新闻网·国内", "url": "https://www.chinanews.com.cn/rss/china.xml", "category": "时政", "language": "ZH" },
      { "name": "中国新闻网·国际", "url": "https://www.chinanews.com.cn/rss/world.xml", "category": "国际", "language": "ZH" },
      { "name": "中国新闻网·财经", "url": "https://www.chinanews.com.cn/rss/finance.xml", "category": "财经", "language": "ZH" },
      { "name": "中国新闻网·体育", "url": "https://www.chinanews.com.cn/rss/sports.xml", "category": "体育", "language": "ZH" },
      { "name": "中国新闻网·娱乐", "url": "https://www.chinanews.com.cn/rss/ent.xml", "category": "娱乐", "language": "ZH" },
      { "name": "中国新闻网·生活", "url": "https://www.chinanews.com.cn/rss/life.xml", "category": "社会", "language": "ZH" }
    ] },
    { "id": "domestic-tech", "label": "科技商业", "sources": [
      { "name": "36Kr", "url": "https://36kr.com/feed", "category": "财经", "language": "ZH" },
      { "name": "IT之家", "url": "https://www.ithome.com/rss/", "category": "科技", "language": "ZH" },
      { "name": "少数派", "url": "https://sspai.com/feed", "category": "科技", "language": "ZH" }
    ] },
    { "id": "international-tech", "label": "国际科技", "sources": [
      { "name": "TechCrunch AI", "url": "https://techcrunch.com/category/artificial-intelligence/feed/", "category": "AI", "language": "EN" },
      { "name": "MIT Technology Review", "url": "https://www.technologyreview.com/feed/", "category": "科技", "language": "EN" },
      { "name": "Hacker News 高热", "url": "https://hnrss.org/newest?points=100", "category": "科技", "language": "EN" },
      { "name": "Google AI", "url": "https://blog.google/technology/ai/rss/", "category": "AI", "language": "EN" },
      { "name": "OpenAI News", "url": "https://openai.com/news/rss.xml", "category": "AI", "language": "EN" }
    ] }
  ],
  "assisted": [
    { "id": "WEIBO", "label": "微博", "domains": ["weibo.com"], "supportsClip": true, "supportsSearch": true },
    { "id": "TOUTIAO", "label": "今日头条", "domains": ["toutiao.com"], "supportsClip": true, "supportsSearch": true },
    { "id": "CCTV", "label": "央视网", "domains": ["cctv.com", "news.cctv.com"], "supportsClip": true, "supportsSearch": true },
    { "id": "X", "label": "X", "domains": ["x.com"], "supportsClip": true, "supportsSearch": true },
    { "id": "WECHAT", "label": "公众号", "domains": ["mp.weixin.qq.com"], "supportsClip": true, "supportsSearch": true }
  ]
}
```

Add default `type: 'RSS'`、`enabled: true`、`refreshMinutes: 60` and `trust: '待核验'` in the TypeScript adapter, not repeatedly in JSON. Do not attach AI-only include keywords to general sources.

- [ ] **Step 4: Replace inline presets**

Remove `domesticRssSources` and `internationalRssSources` from `main.tsx`. Import typed catalog adapters from `src/data/intelligenceSources.ts`.

- [ ] **Step 5: Run catalog and type tests**

Run:

```powershell
npm test
npm run typecheck
```

Expected: unique URLs, all assisted channels, and TypeScript checks pass.

- [ ] **Step 6: Commit**

```powershell
git add content-engine/shared/intelligence-sources.json content-engine/src/data/intelligenceSources.ts content-engine/tests/intelligence-sources.test.mjs content-engine/src/main.tsx
git commit -m "add compliant intelligence source catalog"
```

### Task 4: 情报源页面与关键词筛选

**Files:**
- Modify: `content-engine/src/main.tsx`
- Modify: `content-engine/src/styles.css`
- Create: `content-engine/tests/intelligence-ui-contract.test.mjs`

**Interfaces:**
- `SettingsHub` receives `onOpenClip()` and `onOpenSearch(channel)` callbacks.
- `WebSearchPanel` receives optional `{ label: string, domains: string[] }` preset.
- `Discover` reads `IntelligenceItem.keywords` and maintains a `keyword` filter state.

- [ ] **Step 1: Write failing UI contract tests**

```js
test('source settings separate automatic sources and assisted channels', () => {
  assert.match(mainSource, /自动来源/);
  assert.match(mainSource, /辅助渠道/);
  assert.match(mainSource, /onOpenSearch/);
});

test('discover page filters persisted keywords', () => {
  assert.match(mainSource, /const \[keyword, setKeyword\]/);
  assert.match(mainSource, /signal\.keywords/);
  assert.match(mainSource, /按关键词筛选/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/intelligence-ui-contract.test.mjs`

Expected: FAIL because the tabs and keyword filter are absent.

- [ ] **Step 3: Implement source page state and actions**

Use a compact two-tab control. “自动来源” shows grouped preset rows with checkboxes and one “添加所选来源” command. “辅助渠道” shows one row per channel with icon, label, supported mode and action buttons. Keep the custom RSS form below the automatic source list.

- [ ] **Step 4: Pass assisted search presets through App**

Add App state:

```ts
const [searchPreset, setSearchPreset] = useState<{ label: string; domains: string[] } | null>(null);
```

`onOpenSearch(channel)` sets the preset and navigates to `automation`. `WebSearchPanel` initializes the domain selection from the preset and adds buttons for 微博、今日头条、央视网、公众号 and X.

- [ ] **Step 5: Implement keyword filtering**

Build sorted unique keywords from the visible 30-day intelligence set. Add a keyword select between category and language. Filtering requires `keyword === 'ALL' || signal.keywords?.includes(keyword)`. Card keyword tags use `signal.keywords.slice(0, 2)` and only fall back to legacy source keyword matching for old rows.

- [ ] **Step 6: Apply the existing visual system**

Use the current 5-7px radius, 1px navy borders, macaron fills and compact 40px controls. Automatic source groups use unframed sections with list rows; assisted channels may use repeated cards because each is an actionable item. Do not add explanatory feature cards or animation dependencies.

- [ ] **Step 7: Run tests and build**

Run:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: UI contract, classifier and catalog tests pass; production build succeeds.

- [ ] **Step 8: Commit**

```powershell
git add content-engine/src/main.tsx content-engine/src/styles.css content-engine/tests/intelligence-ui-contract.test.mjs
git commit -m "expand intelligence source and keyword workflows"
```

### Task 5: 真实来源刷新与项目文档

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Uses the running Web at `http://127.0.0.1:5173`
- Uses the running API at `http://127.0.0.1:8787`

- [ ] **Step 1: Add the selected automatic presets in the real Web workspace**

Use the UI, not direct database inserts. Confirm duplicate URLs are skipped.

- [ ] **Step 2: Refresh the real sources**

Verify at least one successful item from multiple domestic categories. Record each failed feed separately without treating the whole refresh as failed.

- [ ] **Step 3: Verify classification and filtering**

Use browser automation to assert:

```text
题材集合 includes 体育、娱乐、社会、国际、财经、科技
关键词下拉 count > 1
选择“体育”后所有可见卡片 category == 体育
选择一个关键词后所有可见卡片 keywords includes selectedKeyword
document.scrollWidth == document.clientWidth
```

- [ ] **Step 4: Verify assisted channels**

Open 微博、今日头条、央视网、X and 公众号 actions. Confirm clip actions open the link editor and search actions preselect the correct domains. Do not execute a paid Tavily query during layout verification.

- [ ] **Step 5: Update project documents with actual evidence**

Record exact source counts, item counts, categories, keyword examples, failed feeds and viewport checks. Do not mark Playwright public-page extraction or AI analysis as complete.

- [ ] **Step 6: Run final verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit and push**

```powershell
git add content-engine docs
git commit -m "complete intelligence source matrix"
git push origin main
```
