export function selectCurrentResearchArtifact(artifacts = []) {
  return artifacts
    .filter((artifact) => artifact?.type === 'RESEARCH_RESULT' && ['CANDIDATE', 'ACCEPTED'].includes(artifact.status))
    .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))[0] ?? null;
}
