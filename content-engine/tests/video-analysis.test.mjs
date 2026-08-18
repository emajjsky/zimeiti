import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildVideoAnalysisPrompt,
  parseVideoAnalysis,
  extractVideoKeyframes,
  withVideoAnalysisOutputDirectory,
  buildVideoAnalysisVisionArgs,
  keyframeTargetForDuration,
  readableVideoAnalysisError,
  supportsVideoAnalysisModel,
  titleFromVideoAnalysis,
  planVideoSegments,
  mergeVideoSegmentResults,
  selectContentKeyframes,
  buildSceneDetectionArgs,
  parseSceneChangeTimes,
  buildVideoSegmentArgs,
} = require('../server/services/video-analysis.cjs');
const { videoAnalysisView } = require('../server/routes/video-analyses.cjs');

const completeVideoAnalysisResult = {
  summary: '完整拉片摘要',
  narrativeStructure: [{
    startSeconds: 0,
    endSeconds: 12,
    segment: '开场',
    content: '提出主题',
    visual: '人物近景',
  }],
  reusableInsights: ['可复用观点'],
  keyframes: [{ timestampSeconds: 6, reason: '信息完整', caption: '开场画面' }],
};

test('拉片处理中间检查点不作为完整结果对外返回', () => {
  const analysis = videoAnalysisView({
    id: 'analysis-checkpoint', project_id: 'project-1', source_asset_id: 'asset-1', status: 'ANALYZING',
    target_platform: 'WECHAT', model: 'qwen3.8-max', progress_json: { phase: 'ANALYZING_SEGMENTS' },
    result_json: { segmentEntries: [] }, keyframe_asset_ids: [], created_at: 'now', updated_at: 'now',
  });
  assert.equal(analysis.result, null);
});

test('拉片进入素材提取阶段后可以对外返回完整分析结果', () => {
  const analysis = videoAnalysisView({
    id: 'analysis-extracting', project_id: 'project-1', source_asset_id: 'asset-1', status: 'EXTRACTING_FRAMES',
    target_platform: 'WECHAT', model: 'qwen3.8-max', progress_json: { phase: 'EXTRACTING_MATERIALS' },
    result_json: completeVideoAnalysisResult, keyframe_asset_ids: [], created_at: 'now', updated_at: 'now',
  });
  assert.deepEqual(analysis.result, completeVideoAnalysisResult);
});

test('拉片历史终态中的不完整结果不按完整结果对外返回', () => {
  const analysis = videoAnalysisView({
    id: 'analysis-incomplete', project_id: 'project-1', source_asset_id: 'asset-1', status: 'SUCCEEDED',
    target_platform: 'WECHAT', model: 'qwen3.8-max', progress_json: { phase: 'SUCCEEDED' },
    result_json: { summary: '历史残留结果' }, keyframe_asset_ids: [], created_at: 'now', updated_at: 'now',
  });
  assert.equal(analysis.result, null);
});

test('拉片终态中的畸形阶段元素不按完整结果对外返回', () => {
  const analysis = videoAnalysisView({
    id: 'analysis-malformed', project_id: 'project-1', source_asset_id: 'asset-1', status: 'SUCCEEDED',
    target_platform: 'WECHAT', model: 'qwen3.8-max', progress_json: { phase: 'SUCCEEDED' },
    result_json: { ...completeVideoAnalysisResult, narrativeStructure: [{}] },
    keyframe_asset_ids: [], created_at: 'now', updated_at: 'now',
  });
  assert.equal(analysis.result, null);
});

test('拉片终态对外返回一致的终态进度，不沿用历史中间阶段', () => {
  const succeeded = videoAnalysisView({
    id: 'analysis-1', project_id: 'project-1', source_asset_id: 'asset-1', status: 'SUCCEEDED',
    target_platform: 'WECHAT', model: 'qwen3.8-max', progress_json: { phase: 'PROBING' },
    result_json: { summary: '完成' }, keyframe_asset_ids: ['frame-1'], created_at: 'now', updated_at: 'now',
  });
  const failed = videoAnalysisView({
    id: 'analysis-2', project_id: 'project-1', source_asset_id: 'asset-1', status: 'FAILED',
    target_platform: 'WECHAT', model: 'qwen3.8-max', progress_json: { phase: 'ANALYZING_SEGMENTS', completedSegments: 2, totalSegments: 3 },
    error: '模型失败', created_at: 'now', updated_at: 'now',
  });
  assert.equal(succeeded.progress.phase, 'SUCCEEDED');
  assert.equal(failed.progress.phase, 'FAILED');
  assert.equal(failed.progress.completedSegments, 2);
});

test('场景检测命令只输出镜头变化时间点，结果不会直接成为关键帧', () => {
  const args = buildSceneDetectionArgs({ videoPath: 'C:/video/demo.mp4', threshold: 0.32 });
  assert.ok(args.includes("select='gt(scene,0.32)',showinfo"));
  assert.deepEqual(parseSceneChangeTimes('n:1 pts:100 pts_time:3.25\nn:2 pts:200 pts_time:8.50\nn:3 pts:201 pts_time:8.50'), [3.25, 8.5]);
});

test('拉片 API 和界面暴露结构化阶段进度', async () => {
  const route = await fs.readFile(new URL('../server/routes/video-analyses.cjs', import.meta.url), 'utf8');
  const workspace = await fs.readFile(new URL('../src/workspaces/create/CreateWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(route, /progress_json/);
  assert.match(workspace, /completedSegments/);
  assert.match(workspace, /DETECTING_SCENES/);
  assert.match(workspace, /ANALYZING_SEGMENTS/);
  assert.match(workspace, /EXTRACTING_MATERIALS/);
});

test('视频拉片入队失败时同时终止分析记录和任务记录', async () => {
  const route = await fs.readFile(new URL('../server/routes/video-analyses.cjs', import.meta.url), 'utf8');
  assert.match(route, /UPDATE video_analyses SET status = 'FAILED'/);
  assert.match(route, /UPDATE jobs SET status = 'FAILED'/);
});

test('视频分段命令按绝对起止时间复制音视频并限制片段时长', () => {
  const args = buildVideoSegmentArgs({ videoPath: 'C:/video/demo.mp4', outputPath: 'C:/tmp/segment.mp4', startSeconds: 295, endSeconds: 600 });
  assert.deepEqual(args.slice(0, 4), ['-hide_banner', '-loglevel', 'error', '-ss']);
  assert.ok(args.includes('295'));
  assert.ok(args.includes('305'));
  assert.ok(args.includes('C:/tmp/segment.mp4'));
});

test('长视频按场景边界组成带重叠的语义片段，而不是按固定间隔抽关键帧', () => {
  const scenes = Array.from({ length: 36 }, (_, index) => index * 50).filter(Boolean);
  const segments = planVideoSegments({ durationSeconds: 1_800, sceneChanges: scenes, targetSeconds: 240, maxSeconds: 300, overlapSeconds: 5 });
  assert.ok(segments.length >= 6 && segments.length <= 9);
  assert.equal(segments[0].startSeconds, 0);
  assert.equal(segments.at(-1).endSeconds, 1_800);
  assert.ok(segments.every((segment) => segment.endSeconds - segment.startSeconds <= 305));
  assert.ok(segments.slice(1).every((segment, index) => segment.startSeconds < segments[index].endSeconds));
});

test('关键帧数量由内容事件决定，固定机位口播保留少量代表帧', () => {
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    timestampSeconds: index * 30,
    reason: '同一人物固定机位口播',
    caption: index < 20 ? '观点一' : '观点二',
    eventKey: index < 20 ? 'topic-1' : 'topic-2',
    valueScore: 0.7,
  }));
  assert.equal(selectContentKeyframes(candidates).length, 2);
});

test('信息密集教程允许保留超过三十个不同内容事件', () => {
  const candidates = Array.from({ length: 48 }, (_, index) => ({ timestampSeconds: index * 20, reason: `步骤 ${index + 1}`, caption: `界面状态 ${index + 1}`, eventKey: `step-${index + 1}`, valueScore: 0.9 }));
  assert.equal(selectContentKeyframes(candidates).length, 48);
});

test('分段结果合并绝对时间、去除重叠事件并记录失败区间', () => {
  const merged = mergeVideoSegmentResults([
    { segment: { id: 'segment-1', startSeconds: 0, endSeconds: 300, status: 'SUCCEEDED' }, result: { summary: '第一段', narrativeStructure: [{ startSeconds: 0, endSeconds: 120, segment: '开场', content: '介绍', visual: '人物' }], reusableInsights: ['观点'], keyframes: [{ timestampSeconds: 295, reason: '演示开始', caption: '设置页', eventKey: 'settings', valueScore: 0.8 }] } },
    { segment: { id: 'segment-2', startSeconds: 295, endSeconds: 600, status: 'SUCCEEDED' }, result: { summary: '第二段', narrativeStructure: [{ startSeconds: 5, endSeconds: 100, segment: '演示', content: '设置', visual: '界面' }], reusableInsights: ['观点'], keyframes: [{ timestampSeconds: 0, reason: '演示开始', caption: '设置页', eventKey: 'settings', valueScore: 0.9 }] } },
    { segment: { id: 'segment-3', startSeconds: 595, endSeconds: 900, status: 'FAILED', error: '模型超时' } },
  ], 900);
  assert.equal(merged.keyframes.length, 1);
  assert.equal(merged.keyframes[0].timestampSeconds, 295);
  assert.equal(merged.narrativeStructure[1].startSeconds, 300);
  assert.deepEqual(merged.coverage.failedRanges, [{ startSeconds: 595, endSeconds: 900, error: '模型超时' }]);
  assert.ok(merged.coverage.ratio > 0.65 && merged.coverage.ratio < 0.67);
});

test('视频拉片提示词联合分析画面、字幕、语音和镜头结构', () => {
  const prompt = buildVideoAnalysisPrompt({ title: '测试视频', targetPlatform: 'WECHAT' });
  assert.match(prompt.system, /画面、字幕、语音、镜头变化/);
  assert.match(prompt.system, /关键帧/);
  assert.match(prompt.system, /不按时间平均分配/);
  assert.doesNotMatch(prompt.system, /选择 \d+ 个关键帧/);
});

test('视频拉片输出包含时间轴和最多九个关键帧', () => {
  const result = parseVideoAnalysis(JSON.stringify({
    summary: '视频摘要',
    narrativeStructure: [{ startSeconds: 0, endSeconds: 12, segment: '开场', content: '提出问题', visual: '人物近景与标题字幕' }],
    reusableInsights: ['可复用观点'],
    keyframes: [{ timestampSeconds: 6, reason: '画面信息完整', caption: '开场关键画面' }],
  }));
  assert.equal(result.keyframes.length, 1);
  assert.equal(parseVideoAnalysis(JSON.stringify({ ...result, keyframes: Array.from({ length: 18 }, (_, index) => ({ timestampSeconds: index * 10, reason: `画面 ${index + 1}`, caption: `关键帧 ${index + 1}` })) })).keyframes.length, 18);
  assert.throws(() => parseVideoAnalysis(JSON.stringify({ ...result, narrativeStructure: [{ ...result.narrativeStructure[0], endSeconds: 0 }] })));
});

test('视频拉片使用 Qwen Vision 视频理解命令而不是 Omni 命令', () => {
  const args = buildVideoAnalysisVisionArgs({ model: 'qwen3.8-max', videoPath: 'C:/video/demo.mp4', prompt: '完整分析视频' });
  assert.deepEqual(args.slice(0, 2), ['vision', 'describe']);
  assert.ok(args.includes('--video'));
  assert.ok(args.includes('qwen3.8-max'));
  assert.equal(args.includes('omni'), false);
});

test('视频拉片服务端拒绝 Omni 并接受 Qwen 3.6 至 3.8', () => {
  assert.equal(supportsVideoAnalysisModel('qwen3.8-max'), true);
  assert.equal(supportsVideoAnalysisModel('qwen3.5-omni-plus'), false);
  assert.equal(supportsVideoAnalysisModel('qwen3.7-text-embedding'), false);
});

test('哈希视频文件名不会成为项目标题，标题由拉片摘要派生', () => {
  assert.equal(titleFromVideoAnalysis('视频完整演示了一款名为GoHome的家庭看护与适老服务APP。后续介绍功能。', '4542fa45a68c50d9b76ef2b8198ff778.mp4'), '一款名为GoHome的家庭看护与适老服务APP');
  assert.equal(titleFromVideoAnalysis('摘要', '产品演示.mp4'), '产品演示');
});

test('旧版时长目标仅保留兼容，不参与内容感知选帧', () => {
  assert.equal(keyframeTargetForDuration(137), 12);
  assert.equal(keyframeTargetForDuration(30), 8);
  assert.equal(keyframeTargetForDuration(900), 30);
});

test('拉片结构错误展示业务错误而不是裸 Zod 数组', () => {
  assert.match(readableVideoAnalysisError(new Error('[{"path":["summary"],"message":"Invalid input"}]')), /返回结构不完整/);
});

test('关键帧截取失败时清除本次任务的输出目录', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-analysis-test-'));
  const outputDirectory = path.join(root, 'frames');
  try {
    await assert.rejects(() => extractVideoKeyframes({
      ffmpeg: `missing-ffmpeg-${Date.now()}`,
      videoPath: path.join(root, 'input.mp4'),
      outputDirectory,
      keyframes: [{ timestampSeconds: 1, reason: '测试失败清理', caption: '测试帧' }],
    }));
    await assert.rejects(() => fs.stat(outputDirectory), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('关键帧持久化失败时清除整个任务输出目录', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'video-analysis-persist-test-'));
  const outputDirectory = path.join(root, 'frames');
  try {
    await assert.rejects(() => withVideoAnalysisOutputDirectory(outputDirectory, async () => {
      await fs.mkdir(outputDirectory, { recursive: true });
      await fs.writeFile(path.join(outputDirectory, 'partial.jpg'), 'partial');
      throw new Error('数据库事务失败');
    }), /数据库事务失败/);
    await assert.rejects(() => fs.stat(outputDirectory), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
