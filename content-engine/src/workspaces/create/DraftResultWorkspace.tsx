import { CheckCircle2, FileText } from 'lucide-react';
import type { ContentDraft, ContentDraftVersion } from '../../domain/content-drafts';

export function DraftResultWorkspace({ draft, version }: { draft: ContentDraft; version: ContentDraftVersion | null }) {
  return <section className="draft-result-workspace">
    <header><CheckCircle2 size={22}/><div><h2>公众号草稿已完成</h2><p>母稿内容、图片顺序和排版模板已经冻结，可在后续步骤生成其他平台草稿。</p></div></header>
    <dl>
      <div><dt>标题</dt><dd>{draft.title || '未命名草稿'}</dd></div>
      <div><dt>版本</dt><dd>{version ? `V${version.versionNumber}` : '已保存'}</dd></div>
      <div><dt>图片</dt><dd>{draft.assets.length} 张</dd></div>
      <div><dt>状态</dt><dd><FileText size={15}/>公众号母稿</dd></div>
    </dl>
  </section>;
}
