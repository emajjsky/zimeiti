const creativePlatforms = new Set(['WECHAT', 'XIAOHONGSHU', 'ZHIHU', 'WEIBO']);

export function shouldInitializeWritingBrief(stage) {
  return stage !== 'planning';
}

function normalized(platforms) {
  return [...new Set((platforms ?? []).filter((platform) => creativePlatforms.has(platform)))];
}

export function resolveWritingBriefPlatforms({ selectedPlatforms, versionPlatforms, plannedPlatforms, activePlatform }) {
  const saved = normalized(selectedPlatforms);
  if (saved.length) return saved;

  const versions = normalized(versionPlatforms);
  if (versions.length) return versions;

  const planned = normalized(plannedPlatforms);
  if (planned.length) return planned;

  const active = normalized([activePlatform]);
  return active.length ? active : ['WECHAT'];
}
