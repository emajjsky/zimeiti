function parsePlan(raw, skills) {
  const candidate = String(raw).trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
  let plan;
  try { plan = JSON.parse(candidate); } catch { throw new Error('核心 Agent 没有返回有效的计划 JSON。'); }
  if (!plan || typeof plan !== 'object' || typeof plan.goal !== 'string' || !Array.isArray(plan.steps)) throw new Error('核心 Agent 返回的计划结构无效。');
  if (plan.steps.length < 1 || plan.steps.length > 6) throw new Error('核心 Agent 的计划步骤数量无效。');
  const allowed = new Map(skills.map((skill) => [skill.skillVersionId, skill]));
  const steps = plan.steps.map((step, index) => {
    if (!step || typeof step !== 'object' || typeof step.skillVersionId !== 'string') throw new Error(`计划第 ${index + 1} 步缺少 Skill。`);
    const skill = allowed.get(step.skillVersionId);
    if (!skill) throw new Error(`计划第 ${index + 1} 步引用了未授权 Skill。`);
    return { index: index + 1, skillVersionId: skill.skillVersionId, skillName: skill.name, executionTarget: skill.executionTarget, scope: skill.manifest.scope, purpose: typeof step.purpose === 'string' ? step.purpose.slice(0, 500) : skill.description, inputs: Array.isArray(step.inputs) ? step.inputs.map(String).slice(0, 10) : [], expectedOutputs: skill.manifest.outputs, requiresConfirmation: Boolean(skill.manifest.requiresConfirmation) };
  });
  return { goal: plan.goal.slice(0, 500), contextSummary: typeof plan.contextSummary === 'string' ? plan.contextSummary.slice(0, 1_000) : '', risks: Array.isArray(plan.risks) ? plan.risks.map(String).slice(0, 8) : [], estimatedCost: typeof plan.estimatedCost === 'string' ? plan.estimatedCost.slice(0, 200) : '调用前确认', steps };
}

module.exports = { parsePlan };
