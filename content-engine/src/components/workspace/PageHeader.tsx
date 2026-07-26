import type { ReactNode } from 'react';

export function PageHeader({
  title,
  eyebrow,
  subtitle,
  actions,
  feedback,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  actions?: ReactNode;
  feedback?: ReactNode;
}) {
  return (
    <header className="page-header">
      {eyebrow && <div className="page-context">{eyebrow}</div>}
      <div className="page-header-main">
        <h1>{title}</h1>
        {actions && <div className="page-header-actions">{actions}</div>}
      </div>
      {subtitle && <p className="page-header-subtitle">{subtitle}</p>}
      {feedback && <div className="page-header-feedback" aria-live="polite">{feedback}</div>}
    </header>
  );
}
