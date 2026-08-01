import { Check, LoaderCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/workspace/PageHeader';
import { webWorkspaces } from '../../data/webApi';
import type { WebSession, WorkspaceSummary } from '../../domain/workspace';

export function WorkspaceManagementSettings({
  session,
  onSessionChange,
  onBeforeSwitch,
}: {
  session: WebSession;
  onSessionChange: (session: WebSession) => void;
  onBeforeSwitch: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState('');
  const [error, setError] = useState('');
  const [createName, setCreateName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [deleting, setDeleting] = useState<WorkspaceSummary | null>(null);
  const [impact, setImpact] = useState<{ projects: number; assets: number; channelAccounts: number; publications: number; metricSnapshots: number; retrospectives: number } | null>(null);
  const [confirmationName, setConfirmationName] = useState('');

  useEffect(() => {
    let active = true;
    void webWorkspaces.list().then((nextSession) => {
      if (active) onSessionChange(nextSession);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : '读取工作空间失败。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [onSessionChange]);

  const activeWorkspaces = session.workspaces.filter(({ status }) => status === 'ACTIVE');

  const createWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = createName.trim();
    if (!name || busyAction) return;
    setBusyAction('create');
    setError('');
    try {
      await onBeforeSwitch();
      const nextSession = await webWorkspaces.create(name);
      setCreateName('');
      onSessionChange(nextSession);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建工作空间失败。');
      setBusyAction('');
    }
  };

  const selectWorkspace = async (workspace: WorkspaceSummary) => {
    if (workspace.id === session.activeWorkspaceId || busyAction) return;
    setBusyAction(`select:${workspace.id}`);
    setError('');
    try {
      await onBeforeSwitch();
      onSessionChange(await webWorkspaces.select(workspace.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '切换工作空间失败。');
      setBusyAction('');
    }
  };

  const renameWorkspace = async (event: React.FormEvent, workspace: WorkspaceSummary) => {
    event.preventDefault();
    const name = editingName.trim();
    if (!name || busyAction) return;
    setBusyAction(`rename:${workspace.id}`);
    setError('');
    try {
      const nextSession = await webWorkspaces.rename(workspace.id, name);
      setEditingId('');
      setEditingName('');
      setBusyAction('');
      onSessionChange(nextSession);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重命名工作空间失败。');
      setBusyAction('');
    }
  };

  const openDeletion = async (workspace: WorkspaceSummary) => {
    setDeleting(workspace); setImpact(null); setConfirmationName(''); setError('');
    try { setImpact(await webWorkspaces.deletionImpact(workspace.id)); } catch (reason) { setError(reason instanceof Error ? reason.message : '读取删除影响失败。'); }
  };

  const removeWorkspace = async () => {
    if (!deleting || confirmationName !== deleting.name || busyAction) return;
    setBusyAction(`delete:${deleting.id}`); setError('');
    try { onSessionChange(await webWorkspaces.remove(deleting.id, confirmationName)); setDeleting(null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '提交空间删除失败。'); }
    finally { setBusyAction(''); }
  };

  return (
    <section className="workspace-management-settings">
      <PageHeader title="工作空间管理" subtitle="每个空间拥有独立的项目、素材、账号配置和后续发布数据。" />
      <form className="workspace-create-form" onSubmit={createWorkspace}>
        <label><span>新工作空间名称</span><input value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={80} /></label>
        <button className="button primary" type="submit" disabled={!createName.trim() || Boolean(busyAction)}>
          {busyAction === 'create' ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}{busyAction === 'create' ? '创建中' : '创建空间'}
        </button>
      </form>
      {error && <p className="workspace-management-error" role="alert">{error}</p>}
      {loading ? (
        <div className="workspace-management-loading"><span /><span /><span /></div>
      ) : activeWorkspaces.length ? (
        <div className="workspace-management-list">
          {activeWorkspaces.map((workspace) => {
            const current = workspace.id === session.activeWorkspaceId;
            const renaming = editingId === workspace.id;
            return (
              <article className={current ? 'current' : ''} key={workspace.id}>
                <div className="workspace-management-copy">
                  <span className="workspace-role">{workspace.role}</span>
                  <h2>{workspace.name}</h2>
                  <p>{current ? '当前正在使用' : '项目和素材与其它空间完全隔离'}</p>
                </div>
                {renaming ? (
                  <form className="workspace-rename-form" onSubmit={(event) => void renameWorkspace(event, workspace)}>
                    <label><span>空间名称</span><input value={editingName} onChange={(event) => setEditingName(event.target.value)} autoFocus maxLength={80} /></label>
                    <div><button className="text-button" type="button" onClick={() => { setEditingId(''); setEditingName(''); }}>取消</button><button className="button primary" type="submit" disabled={!editingName.trim() || Boolean(busyAction)}>保存</button></div>
                  </form>
                ) : (
                  <div className="workspace-management-actions">
                    {current ? <span className="workspace-current-label"><Check size={15} />当前空间</span> : <button className="button" type="button" disabled={Boolean(busyAction)} onClick={() => void selectWorkspace(workspace)}>{busyAction === `select:${workspace.id}` && <LoaderCircle className="spin" size={15} />}切换</button>}
                    {workspace.role === 'OWNER' && <><button className="text-button" type="button" disabled={Boolean(busyAction)} onClick={() => { setEditingId(workspace.id); setEditingName(workspace.name); }}><Pencil size={15} />重命名</button><button className="text-button danger-text" type="button" disabled={Boolean(busyAction)} onClick={() => void openDeletion(workspace)}><Trash2 size={15}/>删除空间</button></>}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <div className="settings-empty-state"><h2>还没有工作空间</h2><p>在上方输入名称创建第一个空间，创建后会立即进入。</p></div>
      )}
      {deleting && <div className="workspace-delete-backdrop" role="presentation"><section className="workspace-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-delete-title"><header><div><h2 id="workspace-delete-title">删除工作空间</h2><p>这是不可逆操作，文件会在后台物理删除。</p></div><button className="icon-button" type="button" aria-label="关闭删除确认" onClick={() => setDeleting(null)}><X size={18}/></button></header>{impact ? <div className="workspace-delete-impact"><b>将删除</b><dl><div><dt>内容项目</dt><dd>{impact.projects}</dd></div><div><dt>空间素材</dt><dd>{impact.assets}</dd></div><div><dt>账号</dt><dd>{impact.channelAccounts}</dd></div><div><dt>已发布内容</dt><dd>{impact.publications}</dd></div><div><dt>指标快照</dt><dd>{impact.metricSnapshots}</dd></div><div><dt>复盘记录</dt><dd>{impact.retrospectives}</dd></div></dl><label><span>输入完整空间名称：{deleting.name}</span><input value={confirmationName} onChange={(event) => setConfirmationName(event.target.value)} autoFocus /></label></div> : <div className="workspace-management-loading"><span/><span/><span/></div>}<footer><button className="button" type="button" onClick={() => setDeleting(null)}>取消</button><button className="button danger" type="button" disabled={!impact || confirmationName !== deleting.name || Boolean(busyAction)} onClick={() => void removeWorkspace()}>{busyAction === `delete:${deleting.id}` ? <LoaderCircle size={15}/> : <Trash2 size={15}/>}确认永久删除</button></footer></section></div>}
    </section>
  );
}
