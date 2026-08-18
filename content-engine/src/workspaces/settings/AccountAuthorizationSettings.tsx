import { useEffect, useState } from 'react';
import { Copy, ExternalLink, KeyRound, LoaderCircle, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/workspace/PageHeader';
import { WebApiError, webChannelAccounts } from '../../data/webApi';
import type { ChannelAccount } from '../../domain/publishing';

const platformLabels: Record<ChannelAccount['platform'], string> = {
  WECHAT: '公众号',
  XIAOHONGSHU: '小红书',
  WEIBO: '微博',
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function AccountAuthorizationSettings() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState({ platform: 'WECHAT' as ChannelAccount['platform'], name: '', externalAccountLabel: '', mode: 'MANUAL' as ChannelAccount['mode'] });
  const [officialDrafts, setOfficialDrafts] = useState<Record<string, { appId: string; appSecret: string }>>({});
  const [officialNetwork, setOfficialNetwork] = useState<{ ipv4: string; checkedAt: string; sources: string[] } | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkError, setNetworkError] = useState('');

  function syncOfficialDrafts(nextAccounts: ChannelAccount[]) {
    setOfficialDrafts((current) => {
      const next = { ...current };
      nextAccounts.filter((account) => account.mode === 'OFFICIAL').forEach((account) => {
        next[account.id] = {
          appId: next[account.id]?.appId ?? account.externalAccountLabel ?? '',
          appSecret: next[account.id]?.appSecret ?? '',
        };
      });
      return next;
    });
  }

  async function loadAccounts() {
    setError('');
    setLoading(true);
    void loadOfficialNetwork();
    try {
      const result = await webChannelAccounts.list();
      setAccounts(result.accounts);
      syncOfficialDrafts(result.accounts);
    } catch (loadError) {
      setError(errorMessage(loadError, '读取账号失败'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAccounts(); }, []);

  async function loadOfficialNetwork() {
    setNetworkLoading(true);
    setNetworkError('');
    try {
      const result = await webChannelAccounts.officialNetwork();
      setOfficialNetwork(result.network);
    } catch (loadError) {
      setOfficialNetwork(null);
      setNetworkError(errorMessage(loadError, '无法检测服务器公网 IP。'));
    } finally {
      setNetworkLoading(false);
    }
  }

  async function copyOfficialNetworkIp() {
    if (!officialNetwork) return;
    try {
      await navigator.clipboard.writeText(officialNetwork.ipv4);
      setNotice(`已复制服务器出口 IP：${officialNetwork.ipv4}`);
    } catch (copyError) {
      setError(errorMessage(copyError, '复制服务器出口 IP 失败。'));
    }
  }

  function updateOfficialDraft(accountId: string, patch: Partial<{ appId: string; appSecret: string }>) {
    setOfficialDrafts((current) => ({
      ...current,
      [accountId]: { appId: current[accountId]?.appId ?? '', appSecret: current[accountId]?.appSecret ?? '', ...patch },
    }));
  }

  function accountStatusLabel(account: ChannelAccount) {
    if (account.mode === 'MANUAL') {
      return account.status === 'MANUAL_READY' ? '手动可用' : '手动发布';
    }
    if (account.status === 'CONNECTED') return '已连接';
    if (account.status === 'ERROR') return '连接异常';
    if (account.status === 'DISCONNECTED') return '待连接';
    return account.status;
  }

  async function createAccount() {
    const name = draft.name.trim();
    if (!name) {
      setError('请先填写账号名称。');
      return;
    }
    setBusy('create');
    setError('');
    setNotice('');
    try {
      const result = await webChannelAccounts.create({ ...draft, name, externalAccountLabel: draft.externalAccountLabel.trim() });
      const nextAccounts = [result.account, ...accounts.filter((account) => account.id !== result.account.id)];
      setAccounts(nextAccounts);
      syncOfficialDrafts(nextAccounts);
      setDraft((current) => ({ ...current, name: '', externalAccountLabel: '' }));
      setNotice(draft.mode === 'MANUAL' ? '账号已保存。现在回到“发布”页，选择这个账号和完成版本，就可以生成发布包。' : '官方接口账号已保存。请在左侧账号行里填写 AppID/AppSecret 并点击“测试连接”。');
    } catch (createError) {
      setError(errorMessage(createError, '创建账号失败'));
    } finally {
      setBusy('');
    }
  }

  async function saveOfficialCredential(account: ChannelAccount) {
    const credential = officialDrafts[account.id] ?? { appId: account.externalAccountLabel, appSecret: '' };
    const appId = credential.appId.trim();
    const appSecret = credential.appSecret.trim();
    if (!appId || !appSecret) {
      setError('请填写 AppID 和 AppSecret。');
      return null;
    }
    setBusy(`official-save:${account.id}`);
    setError('');
    setNotice('');
    try {
      const result = await webChannelAccounts.saveOfficialCredential(account.id, { appId, appSecret });
      setAccounts((current) => current.map((item) => item.id === result.account.id ? result.account : item));
      updateOfficialDraft(account.id, { appId, appSecret: '' });
      setNotice('AppSecret 已加密保存，接下来可以测试连接。');
      return result.account;
    } catch (saveError) {
      setError(errorMessage(saveError, '保存 AppSecret 失败'));
      return null;
    } finally {
      setBusy('');
    }
  }

  async function testOfficialCredential(account: ChannelAccount) {
    const credential = officialDrafts[account.id];
    setBusy(`official-test:${account.id}`);
    setError('');
    setNotice('');
    try {
      if (credential?.appSecret.trim()) {
        const saved = await webChannelAccounts.saveOfficialCredential(account.id, { appId: credential.appId.trim(), appSecret: credential.appSecret.trim() });
        setAccounts((current) => current.map((item) => item.id === saved.account.id ? saved.account : item));
        updateOfficialDraft(account.id, { appId: credential.appId.trim(), appSecret: '' });
      }
      const result = await webChannelAccounts.testOfficialCredential(account.id);
      setAccounts((current) => current.map((item) => item.id === result.account.id ? result.account : item));
      setNotice('测试连接成功。现在发布页可以一键导入公众号草稿箱。');
    } catch (testError) {
      const failedAccount = testError instanceof WebApiError && testError.details && typeof testError.details === 'object' && 'account' in testError.details
        ? (testError.details as { account?: ChannelAccount }).account
        : undefined;
      if (failedAccount) setAccounts((current) => current.map((item) => item.id === failedAccount.id ? failedAccount : item));
      setError(errorMessage(testError, '测试连接失败'));
    } finally {
      setBusy('');
    }
  }

  async function removeAccount(accountId: string) {
    setBusy(accountId);
    setError('');
    try {
      const result = await webChannelAccounts.remove(accountId);
      setAccounts((current) => current.map((account) => account.id === result.account.id ? result.account : account));
    } catch (removeError) {
      setError(errorMessage(removeError, '停用账号失败'));
    } finally {
      setBusy('');
    }
  }

  const summary = {
    total: accounts.length,
    official: accounts.filter((account) => account.mode === 'OFFICIAL').length,
    connected: accounts.filter((account) => account.status === 'CONNECTED').length,
    manual: accounts.filter((account) => account.mode === 'MANUAL').length,
  };

  return (
    <div className="account-authorization-settings">
      <PageHeader title="发布账号" subtitle="手动发布包可立即使用；官方接口账号验证通过后，可一键导入公众号草稿箱。" />
      <section className="account-authorization-summary">
        <div>
          <div className="eyebrow">WECHAT OFFICIAL / ACCOUNT ACCESS</div>
          <h2>把公众号接入状态收束成一页</h2>
          <p>左侧管理已接入账号，右侧创建新账号。官方账号完成 AppID / AppSecret 和测试连接后，发布页即可直接导入草稿箱；手动账号继续保留发布包复制流程。</p>
        </div>
        <div className="account-summary-pills">
          <span className="chip">总计 {summary.total}</span>
          <span className="chip mint">官方 {summary.official}</span>
          <span className="chip blue">已连接 {summary.connected}</span>
          <span className="chip">手动 {summary.manual}</span>
        </div>
      </section>
      <section className="official-network-guide" aria-label="微信 API IP 白名单配置">
        <div className="official-network-guide-copy">
          <div className="eyebrow">WECHAT OFFICIAL / NETWORK</div>
          <h2>配置服务器 IP 白名单</h2>
          <p>自动导入草稿箱由服务端直接调用微信接口。将下方检测到的 IPv4 添加到当前公众号 AppID 的 API IP 白名单。</p>
          <ol>
            <li>打开微信开发者平台，进入当前公众号。</li>
            <li>打开“基础信息”，在“开发密钥”中找到“API IP 白名单”。</li>
            <li>点击编辑，粘贴服务器出口 IP 并保存。</li>
            <li>回到这里点击“测试连接”。</li>
          </ol>
        </div>
        <div className="official-network-guide-actions">
          <span>服务器出口 IPv4</span>
          {networkLoading ? <div className="official-network-value loading"><LoaderCircle className="spin" size={16}/>正在检测</div> : officialNetwork ? <div className="official-network-value"><code>{officialNetwork.ipv4}</code><button className="icon-button" type="button" title="复制服务器出口 IP" aria-label="复制服务器出口 IP" onClick={() => void copyOfficialNetworkIp()}><Copy size={16}/></button><button className="icon-button" type="button" title="重新检测服务器出口 IP" aria-label="重新检测服务器出口 IP" onClick={() => void loadOfficialNetwork()}><RefreshCw size={16}/></button></div> : <div className="official-network-error">{networkError || '尚未检测到服务器出口 IP。'}<button className="icon-button" type="button" title="重新检测服务器出口 IP" aria-label="重新检测服务器出口 IP" onClick={() => void loadOfficialNetwork()}><RefreshCw size={16}/></button></div>}
          {officialNetwork && <small>检测于 {new Date(officialNetwork.checkedAt).toLocaleString('zh-CN', { hour12: false })}</small>}
          <a className="button primary" href="https://developers.weixin.qq.com/" target="_blank" rel="noreferrer">打开微信开发者平台<ExternalLink size={15}/></a>
        </div>
      </section>
      <div className="account-settings-layout">
        <section className="account-list-panel">
          <header>
            <div>
              <h2>平台账号</h2>
              <p>{accounts.length ? `${accounts.length} 个账号可用于发布流程` : '还没有绑定平台账号'}</p>
            </div>
            <button className="text-button" type="button" onClick={() => void loadAccounts()} disabled={loading}>刷新</button>
          </header>
          {error && <div className="settings-error">{error}</div>}
          {notice && <div className="settings-success">{notice}</div>}
          {loading ? <div className="settings-loading"><LoaderCircle className="spin" size={18}/> 正在读取账号</div> : (
            accounts.length ? <div className="channel-account-list">
              {accounts.map((account) => {
                const officialCredential = officialDrafts[account.id] ?? { appId: account.externalAccountLabel, appSecret: '' };
                return (
                  <article className={`channel-account-row ${account.mode === 'OFFICIAL' ? 'official-account-row' : ''}`} key={account.id}>
                    <span className={`account-status-dot ${account.status === 'MANUAL_READY' || account.status === 'CONNECTED' ? 'ready' : ''}`} />
                    <div>
                      <b>{account.name}</b>
                      <small>{platformLabels[account.platform]} · {account.mode === 'MANUAL' ? '手动发布包' : '官方接口（自动草稿箱）'} · {account.externalAccountLabel || '未填写外部标识'}</small>
                      <p>{account.capabilities.reason || (account.mode === 'MANUAL' ? '可生成发布包，发布后手动确认。' : '请保存 AppID/AppSecret，并测试连接。')}</p>
                      {account.mode === 'OFFICIAL' && <div className="official-credential-form">
                        <label>
                          <span>AppID</span>
                          <input value={officialCredential.appId} onChange={(event) => updateOfficialDraft(account.id, { appId: event.target.value })} placeholder="公众号 AppID" />
                        </label>
                        <label>
                          <span>AppSecret</span>
                          <input type="password" value={officialCredential.appSecret} onChange={(event) => updateOfficialDraft(account.id, { appSecret: event.target.value })} placeholder="只用于加密保存，不会明文展示" autoComplete="new-password" />
                        </label>
                        <div className="official-credential-actions">
                          <button className="button" type="button" onClick={() => void saveOfficialCredential(account)} disabled={busy === `official-save:${account.id}` || busy === `official-test:${account.id}`}>
                            {busy === `official-save:${account.id}` ? <LoaderCircle className="spin" size={16}/> : <KeyRound size={16}/>}保存 AppSecret
                          </button>
                          <button className="button primary" type="button" onClick={() => void testOfficialCredential(account)} disabled={busy === `official-save:${account.id}` || busy === `official-test:${account.id}`}>
                            {busy === `official-test:${account.id}` ? <LoaderCircle className="spin" size={16}/> : <KeyRound size={16}/>}测试连接
                          </button>
                        </div>
                      </div>}
                    </div>
                    <span className="chip">{accountStatusLabel(account)}</span>
                    <button className="icon-button danger-icon" type="button" aria-label="停用账号" onClick={() => void removeAccount(account.id)} disabled={Boolean(busy)}>
                      {busy === account.id ? <LoaderCircle className="spin" size={16}/> : <Trash2 size={16}/>}
                    </button>
                  </article>
                );
              })}
            </div> : <section className="settings-empty-state"><KeyRound size={28}/><h2>尚未绑定平台账号</h2><p>先添加一个公众号账号，就可以在发布中心生成发布包或导入草稿箱。</p></section>
          )}
        </section>

        <aside className="account-create-panel">
          <h2><Plus size={18}/> 添加发布账号</h2>
          <div className="account-help-card">
            <b>{draft.mode === 'MANUAL' ? '不知道怎么填？' : '自动草稿箱需要什么？'}</b>
            {draft.mode === 'MANUAL' ? <ol>
              <li>保持“手动发布包”选中。</li>
              <li>账号名称填你自己看得懂的名字，比如“二师兄”。</li>
              <li>备注可不填，直接点“保存手动账号”。</li>
            </ol> : <ol>
              <li>在微信公众平台拿到 AppID/AppSecret。</li>
              <li>配置服务器 IP 白名单，换取 access_token。</li>
              <li>系统会上传封面和正文图片，再调用新增草稿接口。</li>
            </ol>}
          </div>
          <label>
            <span>平台</span>
            <select value={draft.platform} onChange={(event) => setDraft((current) => ({ ...current, platform: event.target.value as ChannelAccount['platform'] }))}>
              <option value="WECHAT">公众号</option>
              <option value="XIAOHONGSHU">小红书</option>
              <option value="WEIBO">微博</option>
            </select>
          </label>
          <label>
            <span>账号名称</span>
            <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="例如：百炼公众号" />
          </label>
          <label className={draft.mode === 'MANUAL' ? 'optional-field' : ''}>
            <span>{draft.mode === 'MANUAL' ? '备注（可不填）' : 'AppID / 原始 ID'}</span>
            <input value={draft.externalAccountLabel} onChange={(event) => setDraft((current) => ({ ...current, externalAccountLabel: event.target.value }))} placeholder={draft.mode === 'MANUAL' ? '不知道就留空' : '先填公众号 AppID，AppSecret 保存后会加密存储'} />
          </label>
          <fieldset>
            <legend>接入方式</legend>
            <button className={draft.mode === 'MANUAL' ? 'chosen' : ''} type="button" onClick={() => setDraft((current) => ({ ...current, mode: 'MANUAL' }))}>手动发布包</button>
            <button className={draft.mode === 'OFFICIAL' ? 'chosen' : ''} type="button" onClick={() => setDraft((current) => ({ ...current, mode: 'OFFICIAL' }))}>官方接口（自动草稿箱）</button>
          </fieldset>
          <p>{draft.mode === 'MANUAL' ? '这不是微信官方绑定，不需要微信扫码、不需要 AppID，只是在系统里创建一个发布目标。后面生成标题、精排正文、图片清单，再手动复制到公众号后台。' : '官方接口会把完成稿自动导入草稿箱，但需要微信公众平台 AppID/AppSecret、服务器 IP 白名单、素材上传能力和新增草稿接口；未验证前不会假成功。'}</p>
          <button className="button primary" type="button" onClick={() => void createAccount()} disabled={busy === 'create'}>
            {busy === 'create' ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>}保存{draft.mode === 'MANUAL' ? '手动' : '官方'}账号
          </button>
        </aside>
      </div>
    </div>
  );
}
