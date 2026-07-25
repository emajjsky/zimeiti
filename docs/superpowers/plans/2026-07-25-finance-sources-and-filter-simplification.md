# Finance Sources And Filter Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the redundant keyword dropdown, make the existing search box match persisted keywords, and add compliant finance RSS and finance search presets.

**Architecture:** Keep category as the only structured topic filter. Move free-text matching into a shared ESM pure function used by React and Node tests. Extend the existing shared source catalog with three verified official finance RSS feeds and two assisted search presets; no new scraper or API credential type is introduced.

**Tech Stack:** React 19, TypeScript, Vite, Node test runner, Fastify RSS pipeline, shared JSON catalogs, Playwright browser acceptance.

## Global Constraints

- Do not add a keyword dropdown or any replacement filter control.
- Persisted article keywords remain visible on cards and become searchable through the existing search box.
- Only verified, currently updating official RSS feeds may be automatic sources.
- Tencent Finance, Sina Finance, 10jqka, Eastmoney and CLS remain user-initiated domain searches, not scheduled scrapers.
- PBOC, NBS, CSRC, SAFE, exchanges, Alibaba IR and Tencent IR remain user-initiated official-source searches.
- Do not bypass login, CAPTCHA, paywalls, anti-bot controls or site access rules.
- Do not add runtime or test dependencies.
- Preserve the current navigation, card layout, macaron palette and 30-day retention policy.
- Update PRD, PLAN, IMPLEMENT and acceptance records in the same implementation.

## File Structure

- Create `content-engine/shared/intelligence-filters.mjs`: framework-free query matching used by React and Node tests.
- Create `content-engine/shared/intelligence-filters.d.mts`: TypeScript contract for the shared ESM module.
- Create `content-engine/tests/intelligence-filters.test.mjs`: behavior tests for title, summary, source and persisted-keyword search.
- Modify `content-engine/src/main.tsx`: remove keyword filter state/control and use the shared matcher; pass finance preset category into Web search.
- Modify `content-engine/shared/intelligence-sources.json`: add official finance RSS and two finance assisted channels.
- Modify `content-engine/src/data/intelligenceSources.ts`: expand assisted-channel IDs and expose `defaultCategory`.
- Modify `content-engine/tests/intelligence-sources.test.mjs`: lock official finance feeds and assisted preset domains.
- Modify `content-engine/tests/intelligence-ui-contract.test.mjs`: remove the obsolete keyword-dropdown source contract while retaining card-keyword coverage.
- Modify `docs/01_PRD_内容引擎.md`, `docs/02_PLAN_内容引擎.md`, `docs/03_IMPLEMENT_内容引擎.md`, `docs/04_ACCEPTANCE_LOG_内容引擎.md`: record final product rules and evidence.

---

### Task 1: Search Persisted Keywords Without A Keyword Dropdown

**Files:**
- Create: `content-engine/shared/intelligence-filters.mjs`
- Create: `content-engine/shared/intelligence-filters.d.mts`
- Create: `content-engine/tests/intelligence-filters.test.mjs`
- Modify: `content-engine/src/main.tsx:310-370`
- Modify: `content-engine/tests/intelligence-ui-contract.test.mjs`

**Interfaces:**
- Consumes: an object with `title`, `summary`, `source`, and optional `keywords` plus a query string.
- Produces: `matchesIntelligenceQuery(item, query): boolean`.

- [ ] **Step 1: Write the failing behavior test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesIntelligenceQuery } from '../shared/intelligence-filters.mjs';

const item = {
  title: '央行发布季度政策报告',
  summary: '市场关注后续资金价格变化',
  source: '中国人民银行',
  keywords: ['利率', '债券'],
};

test('搜索框匹配持久化关键词', () => {
  assert.equal(matchesIntelligenceQuery(item, '债券'), true);
});

test('搜索框继续匹配标题摘要和来源', () => {
  assert.equal(matchesIntelligenceQuery(item, '央行'), true);
  assert.equal(matchesIntelligenceQuery(item, '资金价格'), true);
  assert.equal(matchesIntelligenceQuery(item, '中国人民银行'), true);
});

test('空查询匹配全部且无关查询不匹配', () => {
  assert.equal(matchesIntelligenceQuery(item, '  '), true);
  assert.equal(matchesIntelligenceQuery(item, '篮球'), false);
});
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `node --test tests/intelligence-filters.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `shared/intelligence-filters.mjs`.

- [ ] **Step 3: Implement the shared matcher and its declaration**

```js
// shared/intelligence-filters.mjs
export function matchesIntelligenceQuery(item, query) {
  const normalized = String(query ?? '').trim().toLocaleLowerCase();
  if (!normalized) return true;
  const searchable = [item?.title, item?.summary, item?.source, ...(item?.keywords ?? [])]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
  return searchable.includes(normalized);
}
```

```ts
// shared/intelligence-filters.d.mts
export interface SearchableIntelligence {
  title: string;
  summary: string;
  source: string;
  keywords?: string[];
}

export function matchesIntelligenceQuery(item: SearchableIntelligence, query: string): boolean;
```

- [ ] **Step 4: Wire React to the matcher and remove the duplicate filter**

In `src/main.tsx`:

```ts
import { matchesIntelligenceQuery } from '../shared/intelligence-filters.mjs';
```

Delete:

```ts
const [keyword, setKeyword] = useState('ALL');
const keywordOptions = ...;
```

Replace the text-query portion of `visible` with:

```ts
matchesIntelligenceQuery(signal, query)
```

Delete the `<select aria-label="按关键词筛选">...</select>` control. Keep `keywordTags(signal)` and its `slice(0, 2)` card rendering. In `tests/intelligence-ui-contract.test.mjs`, remove assertions that require keyword state and the keyword dropdown; keep the assertion that cards render at most two persisted keywords.

- [ ] **Step 5: Run focused and full verification**

Run: `node --test tests/intelligence-filters.test.mjs`

Expected: 3 tests PASS.

Run separately:

```powershell
npm test
npm run typecheck
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- content-engine/shared/intelligence-filters.mjs content-engine/shared/intelligence-filters.d.mts content-engine/tests/intelligence-filters.test.mjs content-engine/tests/intelligence-ui-contract.test.mjs content-engine/src/main.tsx
git commit -m "simplify intelligence topic filtering"
```

---

### Task 2: Add Verified Finance Automatic Sources

**Files:**
- Modify: `content-engine/shared/intelligence-sources.json`
- Modify: `content-engine/tests/intelligence-sources.test.mjs`

**Interfaces:**
- Consumes: the existing `automatic[]` source-group JSON contract.
- Produces: an `international-finance` group with three HTTP(S), English, finance-default RSS entries.

- [ ] **Step 1: Add a failing catalog test**

```js
test('国际财经自动源只包含已核验的官方 RSS', () => {
  const group = catalog.automatic.find((item) => item.id === 'international-finance');
  assert.deepEqual(group, {
    id: 'international-finance',
    label: '国际财经',
    sources: [
      { name: '美联储新闻稿', url: 'https://www.federalreserve.gov/feeds/press_all.xml', category: '财经', language: 'EN' },
      { name: '美国 SEC 新闻稿', url: 'https://www.sec.gov/news/pressreleases.rss', category: '财经', language: 'EN' },
      { name: '欧洲央行新闻稿', url: 'https://www.ecb.europa.eu/rss/press.html', category: '财经', language: 'EN' },
    ],
  });
});
```

- [ ] **Step 2: Run the catalog test and verify RED**

Run: `node --test tests/intelligence-sources.test.mjs`

Expected: FAIL because `international-finance` is undefined.

- [ ] **Step 3: Add the exact finance group to the shared catalog**

Insert into `automatic` in `shared/intelligence-sources.json`:

```json
{
  "id": "international-finance",
  "label": "国际财经",
  "sources": [
    { "name": "美联储新闻稿", "url": "https://www.federalreserve.gov/feeds/press_all.xml", "category": "财经", "language": "EN" },
    { "name": "美国 SEC 新闻稿", "url": "https://www.sec.gov/news/pressreleases.rss", "category": "财经", "language": "EN" },
    { "name": "欧洲央行新闻稿", "url": "https://www.ecb.europa.eu/rss/press.html", "category": "财经", "language": "EN" }
  ]
}
```

- [ ] **Step 4: Verify XML accessibility and freshness**

Run this PowerShell probe and inspect every row:

```powershell
$urls=@(
  'https://www.federalreserve.gov/feeds/press_all.xml',
  'https://www.sec.gov/news/pressreleases.rss',
  'https://www.ecb.europa.eu/rss/press.html'
)
foreach($url in $urls){
  $response=Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 20
  [pscustomobject]@{
    Url=$url
    Status=$response.StatusCode
    Type=$response.Headers.'Content-Type'
    HasItems=($response.Content -match '<item[ >]')
    HasCurrentYear=($response.Content -match '2026')
  }
}
```

Expected: all rows have `Status=200`, XML/RSS content type, `HasItems=True`, and `HasCurrentYear=True`.

- [ ] **Step 5: Run focused and full tests**

Run separately:

```powershell
node --test tests/intelligence-sources.test.mjs
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- content-engine/shared/intelligence-sources.json content-engine/tests/intelligence-sources.test.mjs
git commit -m "add official finance rss sources"
```

---

### Task 3: Add Finance Media And Official Search Presets

**Files:**
- Modify: `content-engine/shared/intelligence-sources.json`
- Modify: `content-engine/src/data/intelligenceSources.ts`
- Modify: `content-engine/src/main.tsx:53-260, 983-1065`
- Modify: `content-engine/tests/intelligence-sources.test.mjs`

**Interfaces:**
- Consumes: `AssistedChannel` with `domains` and optional `defaultCategory`.
- Produces: `FINANCE_MEDIA` and `FINANCE_OFFICIAL` presets that open Web search with `defaultCategory: '财经'`.

- [ ] **Step 1: Write failing assisted-channel tests**

```js
test('财经媒体通过主动限定域名搜索接入', () => {
  const channel = catalog.assisted.find((item) => item.id === 'FINANCE_MEDIA');
  assert.deepEqual(channel, {
    id: 'FINANCE_MEDIA',
    label: '财经媒体',
    domains: ['finance.qq.com', 'new.qq.com', 'finance.sina.com.cn', '10jqka.com.cn', 'eastmoney.com', 'cls.cn'],
    defaultCategory: '财经',
    supportsClip: true,
    supportsSearch: true,
  });
});

test('官方财经公告通过主动限定域名搜索接入', () => {
  const channel = catalog.assisted.find((item) => item.id === 'FINANCE_OFFICIAL');
  assert.equal(channel.defaultCategory, '财经');
  assert.deepEqual(channel.domains, [
    'pbc.gov.cn', 'stats.gov.cn', 'csrc.gov.cn', 'safe.gov.cn',
    'sse.com.cn', 'szse.cn', 'bse.cn', 'hkex.com.hk', 'hkexnews.hk',
    'alibabagroup.com', 'tencent.com',
  ]);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `node --test tests/intelligence-sources.test.mjs`

Expected: FAIL because both finance assisted channels are absent.

- [ ] **Step 3: Add both channels to `shared/intelligence-sources.json`**

Append the exact objects asserted in Step 1 to `assisted`.

- [ ] **Step 4: Extend the TypeScript contract**

Update `AssistedChannel` in `src/data/intelligenceSources.ts`:

```ts
export interface AssistedChannel {
  id: 'WEIBO' | 'TOUTIAO' | 'CCTV' | 'X' | 'WECHAT' | 'FINANCE_MEDIA' | 'FINANCE_OFFICIAL';
  label: string;
  domains: string[];
  defaultCategory?: string;
  supportsClip: boolean;
  supportsSearch: boolean;
}
```

- [ ] **Step 5: Pass the default category through the search preset**

Change the App state and `WebSearchPanel` prop type to:

```ts
type SearchPreset = { label: string; domains: string[]; defaultCategory?: string };
```

When opening a channel:

```ts
setSearchPreset({
  label: channel.label,
  domains: channel.domains,
  defaultCategory: channel.defaultCategory,
});
```

In `WebSearchPanel`:

```ts
useEffect(() => {
  if (!preset) return;
  setDomains(preset.domains);
  if (preset.defaultCategory) setCategory(preset.defaultCategory);
}, [preset]);
```

- [ ] **Step 6: Run focused and full verification**

Run: `node --test tests/intelligence-sources.test.mjs`

Expected: all source tests PASS.

Run separately:

```powershell
npm test
npm run typecheck
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit Task 3**

```powershell
git add -- content-engine/shared/intelligence-sources.json content-engine/src/data/intelligenceSources.ts content-engine/src/main.tsx content-engine/tests/intelligence-sources.test.mjs
git commit -m "add finance search presets"
```

---

### Task 4: Documentation And End-To-End Acceptance

**Files:**
- Modify: `docs/01_PRD_内容引擎.md`
- Modify: `docs/02_PLAN_内容引擎.md`
- Modify: `docs/03_IMPLEMENT_内容引擎.md`
- Modify: `docs/04_ACCEPTANCE_LOG_内容引擎.md`

**Interfaces:**
- Consumes: completed behavior and fresh verification evidence from Tasks 1-3.
- Produces: current product rules, implementation detail, plan status and acceptance evidence.

- [ ] **Step 1: Update the four documents with exact final rules**

Record all of the following:

- Topic is the only structured content filter; keywords remain card metadata and searchable text.
- Three international official finance RSS feeds are automatic sources.
- Five Chinese finance media brands are user-initiated domain searches.
- Domestic regulators, exchanges, Alibaba IR and Tencent IR are official-source searches.
- Sina legacy finance RSS was rejected because returned content was last updated in 2018.
- No market quote API, scraper or paid-content ingestion was added.

- [ ] **Step 2: Run full automated verification**

Run:

```powershell
npm test
npm run typecheck
npm run build
git -C .. diff --check
```

Expected: every command exits 0.

- [ ] **Step 3: Verify the browser workflow at desktop width**

At `http://127.0.0.1:5173`:

1. Open “发现”.
2. Confirm the toolbar has source, time, topic, language, search and refresh controls, with no keyword dropdown.
3. Select “财经” and confirm finance cards display without any stale sports keyword condition.
4. Return to “全部题材”, enter the currently visible persisted keyword “篮球”, and confirm the matching sports card remains.
5. Open “情报源 → 辅助渠道”; confirm “财经媒体” and “官方公告” appear.
6. Open each search preset and confirm the page title, domains and default topic “财经”.
7. Confirm browser console has no application error or warning.

- [ ] **Step 4: Verify responsive behavior at 375px**

Confirm the filter toolbar wraps without page-level horizontal overflow, assisted-channel cards become one column, and button labels remain on one line.

- [ ] **Step 5: Commit documents and acceptance evidence**

```powershell
git add -- docs/01_PRD_内容引擎.md docs/02_PLAN_内容引擎.md docs/03_IMPLEMENT_内容引擎.md docs/04_ACCEPTANCE_LOG_内容引擎.md
git commit -m "document finance intelligence workflow"
```

- [ ] **Step 6: Push the verified branch**

```powershell
git push origin main
```
