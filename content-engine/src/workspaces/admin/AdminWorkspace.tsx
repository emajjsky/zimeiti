import { ArrowLeft, Ban, Check, Copy, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2, UserRoundCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { webAdmin } from '../../data/webApi';
import type { ManagedUser, RegistrationInvite, WebSession } from '../../domain/workspace';

type Notice = { type: 'success' | 'error'; text: string } | null;

export function AdminWorkspace({ session, onClose }: { session: WebSession; onClose: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [invites, setInvites] = useState<RegistrationInvite[]>([]);
  const [section, setSection] = useState<'users' | 'invites'>('users');
  const [busy, setBusy] = useState('load');
  const [notice, setNotice] = useState<Notice>(null);
  const [createdCode, setCreatedCode] = useState('');
  const [newUser, setNewUser] = useState({ email: '', password: '', displayName: '', workspaceName: '', platformRole: 'USER' as 'SUPER_ADMIN' | 'USER' });
  const [newInvite, setNewInvite] = useState({ label: '', maxUses: 1, expiresAt: '' });

  const load = async () => {
    setBusy('load'); setNotice(null);
    try {
      const [userResult, inviteResult] = await Promise.all([webAdmin.users(), webAdmin.invites()]);
      setUsers(userResult.users); setInvites(inviteResult.invites);
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '读取管理数据失败。' }); }
    finally { setBusy(''); }
  };

  useEffect(() => { void load(); }, []);

  const createUser = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('create-user'); setNotice(null);
    try {
      await webAdmin.createUser(newUser); setNewUser({ email: '', password: '', displayName: '', workspaceName: '', platformRole: 'USER' });
      await load(); setNotice({ type: 'success', text: '账号已创建。' });
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '创建账号失败。' }); setBusy(''); }
  };

  const updateUser = async (user: ManagedUser, input: { status?: 'ACTIVE' | 'DISABLED'; platformRole?: 'SUPER_ADMIN' | 'USER' }) => {
    setBusy(`user:${user.id}`); setNotice(null);
    try { const result = await webAdmin.updateUser(user.id, input); setUsers((current) => current.map((item) => item.id === user.id ? { ...item, ...result.user } : item)); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '更新用户失败。' }); }
    finally { setBusy(''); }
  };

  const resetPassword = async (user: ManagedUser) => {
    const password = window.prompt(`为 ${user.email} 设置新密码（至少 8 位）`);
    if (!password) return;
    setBusy(`user:${user.id}`); setNotice(null);
    try { await webAdmin.resetPassword(user.id, password); setNotice({ type: 'success', text: `${user.email} 的密码已重置，原登录会话已失效。` }); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '重置密码失败。' }); }
    finally { setBusy(''); }
  };

  const removeUser = async (user: ManagedUser) => {
    if (!window.confirm(`永久删除账号 ${user.email} 及其工作空间数据？此操作不可恢复。`)) return;
    setBusy(`user:${user.id}`); setNotice(null);
    try { await webAdmin.removeUser(user.id); setUsers((current) => current.filter((item) => item.id !== user.id)); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '删除账号失败。' }); }
    finally { setBusy(''); }
  };

  const createInvite = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy('create-invite'); setNotice(null); setCreatedCode('');
    try {
      const result = await webAdmin.createInvite({ label: newInvite.label, maxUses: newInvite.maxUses, expiresAt: newInvite.expiresAt ? new Date(newInvite.expiresAt).toISOString() : null });
      setCreatedCode(result.code); setInvites((current) => [result.invite, ...current]); setNewInvite({ label: '', maxUses: 1, expiresAt: '' });
    } catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '创建邀请码失败。' }); }
    finally { setBusy(''); }
  };

  const toggleInvite = async (invite: RegistrationInvite) => {
    setBusy(`invite:${invite.id}`);
    try { const result = await webAdmin.updateInvite(invite.id, invite.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'); setInvites((current) => current.map((item) => item.id === invite.id ? result.invite : item)); }
    catch (error) { setNotice({ type: 'error', text: error instanceof Error ? error.message : '更新邀请码失败。' }); }
    finally { setBusy(''); }
  };

  return <main className="admin-console">
    <header className="admin-console-head"><div><span className="eyebrow">PLATFORM ADMINISTRATION</span><h1>用户管理后台</h1><p>平台账号、注册资格和访问状态由这里统一管理。</p></div><button className="button" type="button" onClick={onClose}><ArrowLeft size={16}/>返回工作台</button></header>
    <nav className="admin-console-tabs" aria-label="后台管理模块"><button className={section === 'users' ? 'active' : ''} onClick={() => setSection('users')}><UserRoundCog size={16}/>用户账号</button><button className={section === 'invites' ? 'active' : ''} onClick={() => setSection('invites')}><KeyRound size={16}/>注册邀请码</button></nav>
    {notice && <p className={`admin-notice ${notice.type}`} role="status">{notice.text}</p>}
    {busy === 'load' ? <div className="admin-loading"><LoaderCircle className="spin"/>正在读取管理数据</div> : section === 'users' ? <>
      <form className="admin-create-row" onSubmit={createUser}><input type="email" required placeholder="用户邮箱" value={newUser.email} onChange={(event) => setNewUser({ ...newUser, email: event.target.value })}/><input required placeholder="显示名称" value={newUser.displayName} onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })}/><input required placeholder="工作室名称" value={newUser.workspaceName} onChange={(event) => setNewUser({ ...newUser, workspaceName: event.target.value })}/><input type="password" minLength={8} required placeholder="初始密码（至少 8 位）" value={newUser.password} onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}/><select value={newUser.platformRole} onChange={(event) => setNewUser({ ...newUser, platformRole: event.target.value as 'SUPER_ADMIN' | 'USER' })}><option value="USER">普通用户</option><option value="SUPER_ADMIN">超级管理员</option></select><button className="button primary" disabled={Boolean(busy)}><Plus size={16}/>添加账号</button></form>
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>用户</th><th>平台角色</th><th>状态</th><th>工作空间</th><th>注册时间</th><th>操作</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><b>{user.display_name || '未命名'}</b><small>{user.email}</small></td><td><select disabled={user.id === session.user.id || Boolean(busy)} value={user.platformRole} onChange={(event) => void updateUser(user, { platformRole: event.target.value as 'SUPER_ADMIN' | 'USER' })}><option value="USER">普通用户</option><option value="SUPER_ADMIN">超级管理员</option></select></td><td><span className={`admin-status ${user.status.toLowerCase()}`}>{user.status === 'ACTIVE' ? '正常' : '已停用'}</span></td><td>{user.workspaceCount}</td><td>{new Date(user.createdAt).toLocaleDateString('zh-CN')}</td><td><div className="admin-row-actions"><button className="icon-button" title="重置密码" disabled={Boolean(busy)} onClick={() => void resetPassword(user)}><KeyRound size={16}/></button>{user.id !== session.user.id && <><button className="icon-button" title={user.status === 'ACTIVE' ? '停用账号' : '启用账号'} disabled={Boolean(busy)} onClick={() => void updateUser(user, { status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>{user.status === 'ACTIVE' ? <Ban size={16}/> : <Check size={16}/>}</button><button className="icon-button danger" title="删除账号" disabled={Boolean(busy)} onClick={() => void removeUser(user)}><Trash2 size={16}/></button></>}</div></td></tr>)}</tbody></table></div>
    </> : <>
      <form className="admin-create-row invite" onSubmit={createInvite}><input placeholder="用途备注，例如：首批内测" value={newInvite.label} onChange={(event) => setNewInvite({ ...newInvite, label: event.target.value })}/><label>可用次数<input type="number" min={1} max={100} value={newInvite.maxUses} onChange={(event) => setNewInvite({ ...newInvite, maxUses: Number(event.target.value) })}/></label><label>失效时间（可选）<input type="datetime-local" value={newInvite.expiresAt} onChange={(event) => setNewInvite({ ...newInvite, expiresAt: event.target.value })}/></label><button className="button primary" disabled={Boolean(busy)}><Plus size={16}/>生成邀请码</button></form>
      {createdCode && <div className="invite-created"><div><ShieldCheck size={18}/><span>邀请码只完整显示这一次</span><strong>{createdCode}</strong></div><button className="button" onClick={() => void navigator.clipboard.writeText(createdCode)}><Copy size={16}/>复制</button></div>}
      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>邀请码</th><th>用途</th><th>使用情况</th><th>有效期</th><th>状态</th><th>操作</th></tr></thead><tbody>{invites.map((invite) => <tr key={invite.id}><td><code>{invite.code_hint}</code></td><td>{invite.label || '未备注'}</td><td>{invite.used_count} / {invite.max_uses}</td><td>{invite.expires_at ? new Date(invite.expires_at).toLocaleString('zh-CN') : '长期有效'}</td><td><span className={`admin-status ${invite.status.toLowerCase()}`}>{invite.status === 'ACTIVE' ? '可用' : '已停用'}</span></td><td><button className="text-button" disabled={Boolean(busy)} onClick={() => void toggleInvite(invite)}>{invite.status === 'ACTIVE' ? '停用' : '启用'}</button></td></tr>)}</tbody></table></div>
    </>}
  </main>;
}
