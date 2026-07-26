import type { ReactNode } from 'react';
import { discoverTabs, type DiscoverSection } from '../app/navigation.mjs';
import { WorkspaceTabs } from '../components/workspace/WorkspaceTabs';

export function DiscoverWorkspace({
  section,
  onSectionChange,
  inbox,
  search,
  linkImport,
}: {
  section: DiscoverSection;
  onSectionChange: (section: DiscoverSection) => void;
  inbox: ReactNode;
  search: ReactNode;
  linkImport: ReactNode;
}) {
  return (
    <section className="discover-workspace">
      <WorkspaceTabs value={section} tabs={discoverTabs} onChange={onSectionChange} ariaLabel="发现" />
      <div className="workspace-section" role="tabpanel">
        {section === 'inbox' ? inbox : section === 'search' ? search : linkImport}
      </div>
    </section>
  );
}
