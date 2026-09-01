import type { ComponentChildren } from "preact";
import { ErrorAlert } from "../../../../../../components/ErrorAlert";
import { Spinner } from "../../../../../../components/Spinner";

/**
 * The frame every event settings tab renders inside: a sentence saying what
 * the tab configures, the actions that apply to the whole tab, and the form
 * itself. The spacing is the stack's, so no tab can disagree with the one
 * beside it about how far its description sits from its fields.
 */
export function SettingsEditor({
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
  if (loading) return <Spinner label="Loading settings…" />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div class="pk pk-stack">
      <div class="pk-cluster">
        <span class="pk-small">{description}</span>
        {actions}
      </div>
      {children}
    </div>
  );
}
