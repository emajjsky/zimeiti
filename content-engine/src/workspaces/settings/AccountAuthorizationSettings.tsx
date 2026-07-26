import { PageHeader } from '../../components/workspace/PageHeader';

export function AccountAuthorizationSettings() {
  return (
    <div className="account-authorization-settings">
      <PageHeader title="账号授权" />
      <section className="settings-empty-state">
        <h2>尚未绑定平台账号</h2>
        <p>公众号、视频号和小红书授权将在发布流程接入。</p>
      </section>
    </div>
  );
}
