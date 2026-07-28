export const researchQuickAction = {
  label: '制定研究计划',
  request: '根据已确认的规划，制定本项目的研究计划。',
};

export function canPrepareAgentRequest({ request, blockedReason, busy, runIsActive }) {
  return Boolean(request.trim()) && !blockedReason && busy === 'idle' && !runIsActive;
}

export function messagesForAgentThread(messages) {
  return messages.filter((message) => message.messageType !== 'CONFIRMATION');
}
