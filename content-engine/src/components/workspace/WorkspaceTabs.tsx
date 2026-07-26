export type WorkspaceTab<T extends string> = {
  id: T;
  label: string;
};

export function WorkspaceTabs<T extends string>({
  value,
  tabs,
  onChange,
  ariaLabel,
}: {
  value: T;
  tabs: readonly WorkspaceTab<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          className={value === tab.id ? 'active' : ''}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
