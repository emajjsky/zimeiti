import { Check, LoaderCircle, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { platformName } from '../../domain/content';
import type { ProjectArtifact } from '../../domain/creative';

type DiffLine = { kind: 'added' | 'removed' | 'unchanged'; text: string };

function paragraphs(value: string) {
  return value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
}

export function paragraphDiff(before: string, after: string): DiffLine[] {
  const left = paragraphs(before);
  const right = paragraphs(after);
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const result: DiffLine[] = [];
  let i = 0; let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) { result.push({ kind: 'unchanged', text: left[i] }); i += 1; j += 1; }
    else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) { result.push({ kind: 'added', text: right[j] }); j += 1; }
    else { result.push({ kind: 'removed', text: left[i] }); i += 1; }
  }
  return result;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
}

function qualityIssues(value: unknown) {
  if (!value || typeof value !== 'object') return [];
  const review = value as Record<string, unknown>;
  return review.status === 'NEEDS_REVIEW' ? strings(review.issues) : [];
}

function uniqueStrings(...groups: string[][]) {
  return [...new Set(groups.flat().map((item) => item.trim()).filter(Boolean))];
}

export function CopyCandidateDialog({ artifact, current, busy, onAccept, onReject, onClose }: {
  artifact: ProjectArtifact;
  current: { title: string; body: string };
  busy: 'idle' | 'accepting' | 'rejecting';
  onAccept: (selectedTitle?: string) => void;
  onReject: () => void;
  onClose: () => void;
}) {
  const titleOptions = strings(artifact.payload.titleOptions);
  const candidateTitle = typeof artifact.payload.title === 'string' ? artifact.payload.title : titleOptions[0] ?? '未命名候选';
  const candidateBody = typeof artifact.payload.body === 'string' ? artifact.payload.body : '';
  const changeSummary = typeof artifact.payload.changeSummary === 'string' ? artifact.payload.changeSummary : typeof artifact.payload.summary === 'string' ? artifact.payload.summary : '';
  const facts = strings(artifact.payload.factsToVerify);
  const reviewIssues = qualityIssues(artifact.payload.qualityReview);
  const verificationItems = uniqueStrings(facts);
  const needsRewrite = reviewIssues.length > 0;
  const sections = records(artifact.payload.sections);
  const [selectedTitle, setSelectedTitle] = useState(titleOptions[0] ?? '');
  const [previewMode, setPreviewMode] = useState<'document' | 'diff'>('document');
  const [verificationOpen, setVerificationOpen] = useState(false);
  const diff = useMemo(() => paragraphDiff(current.body, candidateBody), [candidateBody, current.body]);
  const canChange = artifact.status === 'CANDIDATE';

  useEffect(() => { setPreviewMode('document'); setVerificationOpen(false); }, [artifact.id]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && busy === 'idle') onClose(); };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close); };
  }, [busy, onClose]);

  return <div className="copy-candidate-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && busy === 'idle') onClose(); }}>
    <section className="copy-candidate-dialog" role="dialog" aria-modal="true" aria-labelledby="copy-candidate-title">
      <header><div><span>{artifact.platform ? platformName[artifact.platform] : '内容项目'}候选</span><h2 id="copy-candidate-title">{artifact.type === 'OUTLINE' ? '审核大纲' : '审核文案'}</h2></div><button className="icon-button" type="button" aria-label="关闭候选" disabled={busy !== 'idle'} onClick={onClose}><X size={18}/></button></header>
      <div className="copy-candidate-body">
        {titleOptions.length > 0 ? <fieldset disabled={!canChange}><legend>标题方案</legend>{titleOptions.map((title) => <label key={title}><input type="radio" name={`candidate-title-${artifact.id}`} checked={selectedTitle === title} onChange={() => setSelectedTitle(title)}/><span>{title}</span></label>)}</fieldset> : <section className="candidate-title"><span>标题</span><h3>{candidateTitle}</h3></section>}
        {changeSummary && <p className="candidate-change-summary">{changeSummary}</p>}
        {needsRewrite && <section className="candidate-verification candidate-quality-block"><header><div><b>正文需重写</b><span>{reviewIssues.length} 项质量问题</span></div></header><ul>{reviewIssues.map((item) => <li key={item}>{item}</li>)}</ul></section>}
        {verificationItems.length > 0 && <section className="candidate-verification"><header><div><b>发布前核验</b><span>{verificationItems.length} 项待处理</span></div><button type="button" aria-expanded={verificationOpen} onClick={() => setVerificationOpen((current) => !current)}>{verificationOpen ? '收起' : '查看核验项'}</button></header>{verificationOpen && <ul>{verificationItems.map((item) => <li key={item}>{item}</li>)}</ul>}</section>}
        {artifact.type === 'OUTLINE' && sections.length > 0 && <ol className="candidate-outline">{sections.map((section, index) => <li key={`${String(section.heading)}-${index}`}><b>{String(section.heading ?? '')}</b>{typeof section.purpose === 'string' && <p>{section.purpose}</p>}{strings(section.keyPoints).length > 0 && <ul>{strings(section.keyPoints).map((point) => <li key={point}>{point}</li>)}</ul>}</li>)}</ol>}
        {artifact.type === 'PLATFORM_COPY' && <section className="candidate-copy-preview" aria-label="候选正文预览">
          <div className="candidate-preview-switch" role="tablist" aria-label="候选预览方式"><button type="button" role="tab" aria-selected={previewMode === 'document'} className={previewMode === 'document' ? 'active' : ''} onClick={() => setPreviewMode('document')}>完整文稿</button><button type="button" role="tab" aria-selected={previewMode === 'diff'} className={previewMode === 'diff' ? 'active' : ''} onClick={() => setPreviewMode('diff')}>段落差异</button></div>
          {previewMode === 'document' ? <article className="candidate-full-copy" role="tabpanel">{paragraphs(candidateBody).length ? paragraphs(candidateBody).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>) : <p className="candidate-copy-empty">候选正文为空</p>}</article> : <section className="candidate-diff" role="tabpanel" aria-label="候选与当前正文差异"><header><div><b>段落差异</b><small>新增、删除和保留</small></div></header><div>{diff.length ? diff.map((line, index) => <p key={`${line.kind}-${index}`} className={line.kind}>{line.text}</p>) : <p className="unchanged">正文暂无内容</p>}</div></section>}
        </section>}
      </div>
      <footer>{canChange ? <><button className="button danger" type="button" disabled={busy !== 'idle'} onClick={onReject}>{busy === 'rejecting' ? <LoaderCircle size={16}/> : <Trash2 size={16}/>}废弃候选</button><button className="button primary" type="button" disabled={busy !== 'idle' || needsRewrite || (artifact.type === 'OUTLINE' && !selectedTitle)} onClick={() => onAccept(artifact.type === 'OUTLINE' ? selectedTitle : undefined)}>{busy === 'accepting' ? <LoaderCircle size={16}/> : <Check size={16}/>} {needsRewrite ? '需先重写' : '采用到正文'}</button></> : <button className="button primary" type="button" onClick={onClose}>关闭</button>}</footer>
    </section>
  </div>;
}
