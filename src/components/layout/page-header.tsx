interface PageHeaderProps {
  title: string;
  description?: string;
  /** Optional right-aligned actions (badges, buttons…). */
  actions?: React.ReactNode;
}

/**
 * The standard inner-page header: a strong title with an optional
 * one-line description and an optional action slot.
 */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-sm text-ink-muted">{description}</p>
          )}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </header>
  );
}
