import { Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/workspace/PageHeader';
import type { WorkspaceProfile } from '../../data/localRepository';
import { platformName, type Platform } from '../../domain/content';

const supportedPlatforms: Platform[] = ['WECHAT', 'VIDEO_CHANNEL', 'XIAOHONGSHU'];

export function WorkspaceProfileSettings({
  workspace,
  onChange,
}: {
  workspace: WorkspaceProfile;
  onChange: (workspace: WorkspaceProfile) => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [topics, setTopics] = useState(workspace.primaryTopics.join('、'));
  const [platforms, setPlatforms] = useState(workspace.enabledPlatforms);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(workspace.name);
    setTopics(workspace.primaryTopics.join('、'));
    setPlatforms(workspace.enabledPlatforms);
  }, [workspace]);

  const togglePlatform = (platform: Platform) => {
    setSaved(false);
    setPlatforms((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);
  };

  const save = () => {
    if (!name.trim() || !platforms.length) return;
    onChange({
      ...workspace,
      name: name.trim(),
      primaryTopics: topics.split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean),
      enabledPlatforms: platforms,
    });
    setSaved(true);
  };

  return (
    <div className="workspace-profile-settings">
      <PageHeader title="工作空间" feedback={saved ? <span className="success-text">已保存</span> : undefined} />
      <section className="settings-form-section">
        <label>工作空间名称<input value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} /></label>
        <label>默认题材<input value={topics} onChange={(event) => { setTopics(event.target.value); setSaved(false); }} /></label>
        <fieldset><legend>内容平台</legend><div className="platform-options">{supportedPlatforms.map((platform) => <button type="button" key={platform} className={platforms.includes(platform) ? 'chosen' : ''} onClick={() => togglePlatform(platform)}>{platformName[platform]}</button>)}</div></fieldset>
        <footer><button className="button primary" type="button" disabled={!name.trim() || !platforms.length} onClick={save}><Save size={16} />保存</button></footer>
      </section>
    </div>
  );
}
