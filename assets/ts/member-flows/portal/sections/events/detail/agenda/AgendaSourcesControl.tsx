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
      aria-label={open ? "Hide session sources" : "Show session sources"}
      title={open ? "Hide session sources" : "Show session sources"}
      aria-pressed={open}
      aria-expanded={open}
      aria-controls={`agenda-sources-${eventSlug}`}
      onClick={onToggle}
    >
      <StrokeIcon>
        <rect x="2" y="2" width="12" height="12" rx="1" />
        <path d={open ? "M10 2v12M4 5l3 3-3 3" : "M10 2v12M7 5 4 8l3 3"} />
      </StrokeIcon>
    </Button>
  );
}
