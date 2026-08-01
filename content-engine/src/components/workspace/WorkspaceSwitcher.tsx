import { Check, ChevronDown, LoaderCircle, Settings } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { webWorkspaces } from '../../data/webApi';
import type { WebSession } from '../../domain/workspace';

export function WorkspaceSwitcher({
  session,
  onSessionChange,
  onBeforeSwitch,
  onManage,
}: {
  session: WebSession;
  onSessionChange: (session: WebSession) => void;
  onBeforeSwitch: () => Promise<void>;
  onManage: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const workspaces = session.workspaces.filter(({ status }) => status === 'ACTIVE');
  const current = workspaces.find(({ id }) => id === session.activeWorkspaceId) ?? null;

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnPointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnPointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const selectWorkspace = async (workspaceId: string) => {
    if (workspaceId === session.activeWorkspaceId || busyId) return;
    setBusyId(workspaceId);
    setError('');
    try {
      await onBeforeSwitch();
      const nextSession = await webWorkspaces.select(workspaceId);
      onSessionChange(nextSession);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '切换工作空间失败。');
      setBusyId('');
    }
  };

  return (
    <div className="workspace-switcher" ref={root}>
      <button
        className="workspace-switcher-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span><small>当前空间</small><b>{current?.name ?? '选择工作空间'}</b></span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="workspace-switcher-menu" role="menu" aria-label="切换工作空间">
          <div className="workspace-switcher-list">
            {workspaces.length ? workspaces.map((workspace) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={workspace.id === session.activeWorkspaceId}
                key={workspace.id}
                disabled={Boolean(busyId)}
                onClick={() => void selectWorkspace(workspace.id)}
              >
                <span><b>{workspace.name}</b><small>{workspace.role}</small></span>
                {busyId === workspace.id ? <LoaderCircle className="spin" size={16} /> : workspace.id === session.activeWorkspaceId ? <Check size={16} /> : null}
              </button>
            )) : <p className="workspace-switcher-empty">还没有可用的工作空间。</p>}
          </div>
          {error && <p className="workspace-switcher-error" role="alert">{error}</p>}
          <button className="workspace-switcher-manage" type="button" role="menuitem" onClick={() => { setOpen(false); onManage(); }}>
            <Settings size={16} />管理工作空间
          </button>
        </div>
      )}
    </div>
  );
}
