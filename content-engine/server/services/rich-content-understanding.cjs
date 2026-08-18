const MEDIA_FLAGS = Object.freeze({ IMAGE: '--image', VIDEO: '--video', AUDIO: '--audio' });

function normalizeRichContentPackage(input = {}) {
  const textInput = input.text && typeof input.text === 'object' ? input.text : {};
  const text = {
    title: String(textInput.title ?? '').trim(),
    body: String(textInput.body ?? '').trim(),
    ...(String(textInput.summary ?? '').trim() ? { summary: String(textInput.summary).trim() } : {}),
    ...(textInput.metadata && typeof textInput.metadata === 'object' ? { metadata: textInput.metadata } : {}),
  };
  const seen = new Set();
  const media = [];
  for (const item of Array.isArray(input.media) ? input.media : []) {
    const kind = String(item?.kind ?? '').toUpperCase();
    const source = String(item?.source ?? '').trim();
    if (!MEDIA_FLAGS[kind] || !source) continue;
    const key = `${kind}:${source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    media.push({
      kind,
      source,
      ...(String(item?.label ?? '').trim() ? { label: String(item.label).trim() } : {}),
      ...(String(item?.origin ?? '').trim() ? { origin: String(item.origin).trim() } : {}),
    });
  }
  return { text, media };
}

function buildRichContentOmniArgs({ model, system, message, content, maxTokens = 3_000 }) {
  const normalized = normalizeRichContentPackage(content);
  const args = ['omni', '--model', String(model), '--system', String(system), '--message', String(message)];
  for (const item of normalized.media) args.push(MEDIA_FLAGS[item.kind], item.source);
  args.push('--text-only', '--max-tokens', String(maxTokens), '--output', 'json');
  return args;
}

function parseJson(value) {
  try { return JSON.parse(String(value).trim()); } catch { return null; }
}

function extractOmniText(raw) {
  const rawText = String(raw ?? '').trim();
  if (!rawText) return '';
  const payload = parseJson(rawText) ?? parseJson(rawText.split(/\r?\n/).map((item) => item.trim()).reverse().find(Boolean));
  if (!payload) return rawText;
  if (typeof payload === 'string') return payload.trim();
  const candidates = [payload.text, payload.output, payload.content, payload.choices?.[0]?.message?.content, payload.result?.text, payload.data?.text, payload.transcript, payload.result?.transcript];
  return candidates.find((item) => typeof item === 'string' && item.trim())?.trim() ?? '';
}

function parseStructuredOmniOutput(raw, schema, label = '多模态任务') {
  const content = extractOmniText(raw);
  if (!content) throw new Error(`${label}没有返回可用内容。`);
  const normalized = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = parseJson(normalized);
  if (!parsed) throw new Error(`${label}没有返回有效 JSON。`);
  return schema.parse(parsed);
}

module.exports = { normalizeRichContentPackage, buildRichContentOmniArgs, extractOmniText, parseStructuredOmniOutput };
