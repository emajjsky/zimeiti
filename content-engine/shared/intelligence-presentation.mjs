const tones = ['tone-blue', 'tone-mint', 'tone-yellow', 'tone-coral', 'tone-lilac'];

export function toneForValue(value) {
  const hash = [...String(value ?? '')].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return tones[hash % tones.length];
}

export function formatIntelligenceTime(value, now = Date.now()) {
  if (value === '刚刚') return value;
  const timestamp = new Date(value).valueOf();
  if (!Number.isFinite(timestamp)) return String(value ?? '');
  const date = new Date(timestamp);
  const current = new Date(now);
  const startToday = new Date(current.getFullYear(), current.getMonth(), current.getDate()).valueOf();
  const startYesterday = startToday - 24 * 60 * 60 * 1000;
  const pad = (part) => String(part).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (timestamp >= startToday) return `今天 ${time}`;
  if (timestamp >= startYesterday) return `昨天 ${time}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}
