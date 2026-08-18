import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('新建创作使用独立工作态，不与项目台账同时渲染', () => {
  const source = fs.readFileSync(new URL('../src/workspaces/create/CreativeProjectCenter.tsx', import.meta.url), 'utf8');
  assert.match(source, /if \(creating\) \{[\s\S]*return <section className="creative-project-center creation-mode">[\s\S]*<ContentIngestionPanel/);
  assert.doesNotMatch(source, /\{creating && <ContentIngestionPanel/);
});

test('四种创作入口在桌面保持同一行并按断点收敛', () => {
  const styles = fs.readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.content-ingestion-intents\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /@media \(max-width:\s*1000px\)[\s\S]*\.content-ingestion-intents\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /@media \(max-width:\s*800px\)[\s\S]*\.content-ingestion-intents,[\s\S]*grid-template-columns:\s*1fr/);
});

test('内容读取进行中只保留一个明确的停止读取动作', () => {
  const source = fs.readFileSync(new URL('../src/workspaces/create/ContentIngestionPanel.tsx', import.meta.url), 'utf8');
  assert.match(source, /!readingActive && <button className="icon-button"[\s\S]*aria-label="关闭新建创作"/);
  assert.match(source, />停止读取<\/button>/);
  assert.doesNotMatch(source, />取消读取<\/button>/);
  assert.doesNotMatch(source, /<footer><button className="button" type="button" onClick=\{onClose\}>取消<\/button>/);
  assert.doesNotMatch(source, /关闭后读取任务会继续在后台处理/);
});

test('视频拉片成功入队后才进入项目页，失败会删除刚创建的空项目', () => {
  const source = fs.readFileSync(new URL('../src/workspaces/create/ContentIngestionPanel.tsx', import.meta.url), 'utf8');
  const branchStart = source.indexOf("if (mode === 'VIDEO')");
  const branchEnd = source.indexOf("if (ingestion &&", branchStart);
  const videoBranch = source.slice(branchStart, branchEnd);
  const createdIndex = videoBranch.indexOf('onProjectCreated(project)');
  const analysisIndex = videoBranch.indexOf('await webCreative.startVideoAnalysis');
  assert.ok(createdIndex >= 0 && analysisIndex >= 0);
  assert.ok(analysisIndex < createdIndex);
  assert.match(videoBranch, /catch[\s\S]*onDeleteProject\(project\.id\)/);
  assert.doesNotMatch(videoBranch, /catch\(\(\) => undefined\)/);
});

test('进行中的视频拉片独占创作工作区，不同时展示普通内容规划', () => {
  const source = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /videoAnalysisInProgress/);
  assert.match(source, /!videoAnalysisInProgress && !hasActiveDerivedDraft && <nav className="creative-stage-nav"/);
  assert.match(source, /!videoAnalysisInProgress && visibleStage === 'preparation'/);
});

test('已完成的视频拉片结果只在内容准备阶段展示，不污染后续创作阶段', () => {
  const source = fs.readFileSync(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(source, /const showVideoAnalysis = videoAnalysisInProgress \|\| visibleStage === 'preparation'/);
  assert.match(source, /showVideoAnalysis && videoAnalyses\[0\] && <section className=\{`video-analysis-workspace/);
});
