import type { ProjectStatus, TopicStatus } from './content';

const topicTransitions: Record<TopicStatus, TopicStatus[]> = {
  PENDING: ['ACCEPTED', 'DISCARDED'],
  ACCEPTED: ['PROJECT_CREATED', 'DISCARDED'],
  PROJECT_CREATED: [],
  DISCARDED: [],
};

const projectTransitions: Record<ProjectStatus, ProjectStatus[]> = {
  BRIEF: ['WRITING', 'ARCHIVED'],
  WRITING: ['VISUAL', 'REVIEW', 'ARCHIVED'],
  VISUAL: ['VIDEO', 'REVIEW', 'ARCHIVED'],
  VIDEO: ['REVIEW', 'ARCHIVED'],
  REVIEW: ['WRITING', 'VISUAL', 'VIDEO', 'SCHEDULED'],
  SCHEDULED: ['PARTIALLY_PUBLISHED', 'PUBLISHED', 'REVIEW'],
  PARTIALLY_PUBLISHED: ['PUBLISHED', 'REVIEW'],
  PUBLISHED: ['RETROSPECTIVE'],
  RETROSPECTIVE: ['ARCHIVED', 'WRITING'],
  ARCHIVED: [],
};

export function canTransitionTopic(from: TopicStatus, to: TopicStatus) {
  return topicTransitions[from].includes(to);
}

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus) {
  return projectTransitions[from].includes(to);
}
