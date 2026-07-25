const taxonomy = require('../../shared/intelligence-taxonomy.json');

const allowedCategories = new Set(taxonomy.categories.map((category) => category.id));

function normalize(value) {
  return String(value ?? '').normalize('NFKC').toLocaleLowerCase();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function includesTerm(text, keyword) {
  const normalizedKeyword = normalize(keyword);
  if (!normalizedKeyword) return false;
  if (/^[a-z0-9 ]+$/i.test(normalizedKeyword)) {
    return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(normalizedKeyword)}(?=$|[^a-z0-9])`, 'i').test(text);
  }
  return text.includes(normalizedKeyword);
}

function classifyIntelligence({ title = '', summary = '', fallbackCategory = '其它' } = {}) {
  const titleText = normalize(title);
  const summaryText = normalize(summary);
  const ranked = taxonomy.categories
    .map((category, order) => {
      const matched = category.keywords.filter((keyword) => includesTerm(titleText, keyword) || includesTerm(summaryText, keyword));
      const score = matched.reduce((total, keyword) => total + (includesTerm(titleText, keyword) ? 3 : 1), 0);
      return { category: category.id, matched, score, order };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.order - right.order);

  if (ranked[0]) return { category: ranked[0].category, keywords: ranked[0].matched.slice(0, 5) };
  return { category: allowedCategories.has(fallbackCategory) ? fallbackCategory : '其它', keywords: [] };
}

module.exports = { classifyIntelligence };
