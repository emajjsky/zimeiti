const stageOrder = { COPY: 0, VISUAL: 1, LAYOUT: 2, REVIEW: 3, READY: 3 };
const viewOrder = { copy: 0, visual: 1, layout: 2, review: 3 };

export function canOpenChannelView(stage = 'COPY', view = 'copy', hasCopy = false) {
  if (view === 'copy') return true;
  if (!hasCopy) return false;
  return (stageOrder[stage] ?? 0) >= (viewOrder[view] ?? Number.POSITIVE_INFINITY);
}

export function channelViewForStage(stage = 'COPY', hasCopy = false) {
  if (!hasCopy || stage === 'COPY') return 'copy';
  if (stage === 'VISUAL') return 'visual';
  if (stage === 'LAYOUT') return 'layout';
  return 'review';
}
