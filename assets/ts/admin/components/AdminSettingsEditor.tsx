import type { ComponentChildren } from "preact";
import { ErrorAlert } from "../../components/ErrorAlert";
import { Spinner } from "../../components/Spinner";

export function AdminSettingsEditor({
  loading,
  error,
  description,
  actions,
  children,
}: {
  loading: boolean;
  error: string | null;
  description: string;
  actions: ComponentChildren;
  children: ComponentChildren;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div>
      <div class="d-flex gap-2 align-items-center mb-3 flex-wrap">
        <span class="small text-muted">{description}</span>
        {actions}
      </div>
      {children}
    </div>
  );
}
