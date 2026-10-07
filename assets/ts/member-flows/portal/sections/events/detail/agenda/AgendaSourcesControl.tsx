import { Button } from "../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../ui/MediaIcons";

export function AgendaSourcesControl({
  eventSlug,
  open,
  onToggle,
}: {
  eventSlug: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      variant="secondary"
      icon
      aria-label="Session sources"
      title="Session sources"
      aria-pressed={open}
      aria-expanded={open}
      aria-controls={`agenda-sources-${eventSlug}`}
      onClick={onToggle}
    >
      <StrokeIcon>
        <rect x="2" y="2" width="12" height="12" rx="1" />
        <path d="M10 2v12" />
      </StrokeIcon>
    </Button>
  );
}
