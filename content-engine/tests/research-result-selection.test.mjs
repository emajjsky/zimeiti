import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCurrentResearchArtifact } from '../src/domain/research-result-selection.mjs';

test('latest accepted research result wins over stale older candidates', () => {
  const artifacts = [
    { id: 'accepted-latest', type: 'RESEARCH_RESULT', status: 'ACCEPTED', createdAt: '2026-07-30T16:11:49.331Z' },
    { id: 'candidate-old', type: 'RESEARCH_RESULT', status: 'CANDIDATE', createdAt: '2026-07-30T15:33:22.959Z' },
  ];

  assert.equal(selectCurrentResearchArtifact(artifacts)?.id, 'accepted-latest');
});

test('new candidate wins over the previously accepted research result', () => {
  const artifacts = [
    { id: 'candidate-latest', type: 'RESEARCH_RESULT', status: 'CANDIDATE', createdAt: '2026-07-31T01:00:00.000Z' },
    { id: 'accepted-old', type: 'RESEARCH_RESULT', status: 'ACCEPTED', createdAt: '2026-07-30T16:11:49.331Z' },
  ];

  assert.equal(selectCurrentResearchArtifact(artifacts)?.id, 'candidate-latest');
});
