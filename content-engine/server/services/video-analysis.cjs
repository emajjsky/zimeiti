const { spawn } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { z } = require('zod');

const VIDEO_ANALYSIS_SCOPE = 'VIDEO_ANALYSIS';

function supportsVideoAnalysisModel(model) {
  const value = String(model ?? '');
  return /qwen3\.[6-8](?:[-_.]|$)/i.test(value) && !/(?:omni|embedding|rerank)/i.test(value);
}
const videoAnalysisSchema = z.object({
  summary: z.string().trim().min(1).max(3_000),
  narrativeStructure: z.array(z.object({
    startSeconds: z.number().min(0),
    endSeconds: z.number().positive(),
    segment: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(1_000),
    visual: z.string().trim().min(1).max(1_000),
  })).min(1).max(200),
  reusableInsights: z.array(z.string().trim().min(1).max(500)).max(200),
  keyframes: z.array(z.object({
    timestampSeconds: z.number().min(0),
    reason: z.string().trim().min(1).max(500),
    caption: z.string().trim().min(1).max(200),
    eventKey: z.string().trim().min(1).max(200).optional(),
    valueScore: z.number().min(0).max(1).optional(),
  })).max(200),
});

function planVideoSegments({ durationSeconds, sceneChanges = [], targetSeconds = 240, maxSeconds = 300, overlapSeconds = 5 }) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('视频时长必须大于零。');
  const target = Math.max(30, Number(targetSeconds) || 240);
  const maximum = Math.max(target, Number(maxSeconds) || 300);
  const overlap = Math.max(0, Math.min(Number(overlapSeconds) || 0, target / 4));
  const boundaries = [...new Set([0, ...sceneChanges.map(Number).filter((value) => Number.isFinite(value) && value > 0 && value < duration), duration])].sort((a, b) => a - b);
  const segments = [];
  let logicalStart = 0;
  while (logicalStart < duration) {
    const targetEnd = Math.min(duration, logicalStart + target);
    const maxEnd = Math.min(duration, logicalStart + maximum);
    const candidates = boundaries.filter((value) => value > logicalStart + 30 && value <= maxEnd);
    const afterTarget = candidates.find((value) => value >= targetEnd);
    const beforeTarget = [...candidates].reverse().find((value) => value < targetEnd);
    const logicalEnd = afterTarget ?? beforeTarget ?? maxEnd;
    const startSeconds = segments.length ? Math.max(0, logicalStart - overlap) : logicalStart;
    segments.push({ id: `segment-${segments.length + 1}`, startSeconds, endSeconds: logicalEnd, status: 'PENDING' });
    if (logicalEnd >= duration) break;
    logicalStart = logicalEnd;
  }
  return segments;
}

function keyframeEventKey(frame) {
  return String(frame.eventKey || frame.caption || frame.reason || frame.timestampSeconds).trim().toLowerCase();
}

function selectContentKeyframes(candidates) {
  const selected = new Map();
  for (const frame of Array.isArray(candidates) ? candidates : []) {
    const key = keyframeEventKey(frame);
    const previous = selected.get(key);
    if (!previous || Number(frame.valueScore ?? 0.5) > Number(previous.valueScore ?? 0.5)) selected.set(key, frame);
  }
  return [...selected.values()].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

function coveredDuration(segments) {
  const ranges = segments.map((segment) => [segment.startSeconds, segment.endSeconds]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let active = null;
  for (const range of ranges) {
    if (!active || range[0] > active[1]) {
      if (active) total += active[1] - active[0];
      active = [...range];
    } else active[1] = Math.max(active[1], range[1]);
  }
  return total + (active ? active[1] - active[0] : 0);
}

function mergeVideoSegmentResults(entries, durationSeconds) {
  const successful = entries.filter((entry) => entry.segment.status === 'SUCCEEDED' && entry.result);
  const failedRanges = entries.filter((entry) => entry.segment.status === 'FAILED').map((entry) => ({ startSeconds: entry.segment.startSeconds, endSeconds: entry.segment.endSeconds, error: entry.segment.error || entry.error || '分段理解失败' }));
  const narrativeStructure = successful.flatMap(({ segment, result }) => result.narrativeStructure.map((item) => ({ ...item, startSeconds: segment.startSeconds + item.startSeconds, endSeconds: Math.min(segment.endSeconds, segment.startSeconds + item.endSeconds) })))
    .filter((item) => item.endSeconds > item.startSeconds)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const keyframes = selectContentKeyframes(successful.flatMap(({ segment, result }) => result.keyframes.map((item) => ({ ...item, timestampSeconds: Math.min(segment.endSeconds, segment.startSeconds + item.timestampSeconds) }))));
  const reusableInsights = [...new Set(successful.flatMap(({ result }) => result.reusableInsights))];
  const coveredSeconds = coveredDuration(successful.map(({ segment }) => segment));
  const duration = Math.max(1, Number(durationSeconds) || 1);
  return {
    summary: successful.map(({ result }) => result.summary).filter(Boolean).join('\n\n'),
    narrativeStructure,
    reusableInsights,
    keyframes,
    segments: entries.map(({ segment }) => segment),
    coverage: { ratio: Math.min(1, coveredSeconds / duration), failedRanges },
  };
}

function keyframeTargetForDuration(durationSeconds) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return 12;
  return Math.min(30, Math.max(8, Math.ceil(duration / 12)));
}

function buildVideoAnalysisPrompt({ title, targetPlatform, durationSeconds }) {
  return {
    system: [
      '你是视频拉片编辑。完整理解视频画面、字幕、语音、镜头变化和叙事结构，输出可用于公众号创作的拉片结果。',
      '关键帧对应有独立内容价值的事件、观点、操作步骤、人物变化或叙事转折。根据内容密度选择，可以为零张或多张，不按时间平均分配。',
      '同一内容事件使用相同 eventKey；valueScore 表示画面作为公众号素材的价值，范围为 0 到 1。',
      '只返回严格 JSON，不要 Markdown、解释或额外字段。',
    ].join('\n'),
    message: JSON.stringify({
      title,
      targetPlatform,
      durationSeconds,
      outputSchema: {
        summary: '视频整体摘要',
        narrativeStructure: [{ startSeconds: 0, endSeconds: 12, segment: '段落名称', content: '内容事件', visual: '画面与镜头信息' }],
        reusableInsights: ['可用于创作的观点、事实或表达'],
        keyframes: [{ timestampSeconds: 6, reason: '对应的内容事件和选择理由', caption: '关键帧标题', eventKey: '稳定的内容事件标识', valueScore: 0.9 }],
      },
    }),
  };
}

function buildVideoAnalysisVisionArgs({ model, videoPath, prompt }) {
  return ['vision', 'describe', '--video', String(videoPath), '--model', String(model), '--prompt', String(prompt), '--output', 'json'];
}

function readableVideoAnalysisError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '视频拉片失败。');
  if (/invalid_type|too_big|too_small|expected.*received|\"path\"/i.test(message)) return '视频拉片模型返回结构不完整，请重新执行拉片。';
  return message;
}

function titleFromVideoAnalysis(summary, sourceTitle = '') {
  const source = String(sourceTitle ?? '').trim().replace(/\.[^.]+$/, '');
  if (source && !/^[a-f0-9]{32,64}$/i.test(source)) return source.slice(0, 80);
  const sentence = String(summary ?? '').trim().split(/[。！？\n]/, 1)[0]
    .replace(/^(?:本)?视频(?:完整)?(?:演示|介绍|展示)(?:了)?/u, '')
    .trim();
  return sentence ? sentence.slice(0, 60) : '视频拉片项目';
}

function parseVideoAnalysis(content) {
  const normalized = String(content ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  let parsed;
  try { parsed = JSON.parse(normalized); } catch { throw new Error('视频拉片模型返回的内容不是有效 JSON。'); }
  const result = videoAnalysisSchema.parse(parsed);
  for (const segment of result.narrativeStructure) {
    if (segment.endSeconds <= segment.startSeconds) throw new Error('视频拉片时间轴结束时间必须晚于开始时间。');
  }
  return result;
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} 执行失败：${stderr.slice(-1_500)}`)));
  });
}

function buildSceneDetectionArgs({ videoPath, threshold = 0.32 }) {
  return ['-hide_banner', '-i', String(videoPath), '-vf', `select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-'];
}

function parseSceneChangeTimes(output) {
  return [...new Set([...String(output ?? '').matchAll(/pts_time:([0-9]+(?:\.[0-9]+)?)/g)].map((match) => Number(match[1])).filter(Number.isFinite))].sort((a, b) => a - b);
}

function buildVideoSegmentArgs({ videoPath, outputPath, startSeconds, endSeconds }) {
  const duration = Math.max(0.1, Number(endSeconds) - Number(startSeconds));
  return ['-hide_banner', '-loglevel', 'error', '-ss', String(startSeconds), '-i', String(videoPath), '-t', String(duration), '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-y', String(outputPath)];
}

function captureProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} 执行失败：${stderr.slice(-1_500)}`)));
  });
}

async function detectSceneChanges({ ffmpeg = 'ffmpeg', videoPath, threshold = 0.32 }) {
  const result = await captureProcess(ffmpeg, buildSceneDetectionArgs({ videoPath, threshold }));
  return parseSceneChangeTimes(`${result.stdout}\n${result.stderr}`);
}

async function extractVideoSegment({ ffmpeg = 'ffmpeg', videoPath, outputPath, startSeconds, endSeconds }) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runProcess(ffmpeg, buildVideoSegmentArgs({ videoPath, outputPath, startSeconds, endSeconds }));
  return outputPath;
}

function probeVideoDuration({ ffprobe = 'ffprobe', videoPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', videoPath], { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      const duration = Number(stdout.trim());
      if (code === 0 && Number.isFinite(duration) && duration > 0) resolve(duration);
      else reject(new Error(`无法读取视频时长：${stderr.trim() || 'ffprobe 未返回有效时长'}`));
    });
  });
}

async function extractVideoKeyframes({ ffmpeg = 'ffmpeg', videoPath, outputDirectory, keyframes }) {
  await fs.mkdir(outputDirectory, { recursive: true });
  try {
    const outputs = [];
    for (const [index, frame] of keyframes.entries()) {
      const filename = `${String(index + 1).padStart(2, '0')}-${randomUUID()}.jpg`;
      const outputPath = path.join(outputDirectory, filename);
      await runProcess(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', String(frame.timestampSeconds), '-i', videoPath, '-frames:v', '1', '-q:v', '2', '-y', outputPath]);
      const buffer = await fs.readFile(outputPath);
      outputs.push({ ...frame, filename, outputPath, sizeBytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') });
    }
    return outputs;
  } catch (error) {
    await fs.rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function withVideoAnalysisOutputDirectory(outputDirectory, operation) {
  try {
    return await operation();
  } catch (error) {
    await fs.rm(outputDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

module.exports = {
  VIDEO_ANALYSIS_SCOPE,
  supportsVideoAnalysisModel,
  buildVideoAnalysisPrompt,
  buildVideoAnalysisVisionArgs,
  keyframeTargetForDuration,
  readableVideoAnalysisError,
  titleFromVideoAnalysis,
  planVideoSegments,
  mergeVideoSegmentResults,
  selectContentKeyframes,
  probeVideoDuration,
  buildSceneDetectionArgs,
  parseSceneChangeTimes,
  buildVideoSegmentArgs,
  detectSceneChanges,
  extractVideoSegment,
  parseVideoAnalysis,
  extractVideoKeyframes,
  withVideoAnalysisOutputDirectory,
};
