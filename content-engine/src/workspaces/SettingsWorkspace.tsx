import type { ReactNode } from 'react';
import { settingsTabs, type SettingsSection } from '../app/navigation.mjs';

export function SettingsWorkspace({
  section,
  onSectionChange,
  workspace,
  sources,
  voices,
  models,
  feishu,
  accounts,
}: {
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  workspace: ReactNode;
  sources: ReactNode;
  voices: ReactNode;
  models: ReactNode;
  feishu: ReactNode;
  accounts: ReactNode;
}) {
  const panels: Record<SettingsSection, ReactNode> = { workspace, sources, voices, models, feishu, accounts };

  return (
    <section className="settings-workspace">
      <nav className="settings-subnav" aria-label="设置">
        {settingsTabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id ? 'page' : undefined}
            className={section === item.id ? 'active' : ''}
            onClick={() => onSectionChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="settings-content">{panels[section]}</div>
    </section>
  );
}
