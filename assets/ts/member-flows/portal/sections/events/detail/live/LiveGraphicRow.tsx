import type { ComponentChildren } from "preact";
import { Button } from "../../../../../../ui/Button";
import { StrokeIcon } from "../../../../../../ui/MediaIcons";
import "./LiveGraphicRow.css";

/** One graphic in the Graphics panel: its name, what it shows now, its settings and where it goes. */
export function LiveGraphicRow({
  name,
  detail,
  settings,
  children,
}: {
  name: string;
  detail: string;
  settings?: { label: string; onOpen: () => void; disabled?: boolean };
  children: ComponentChildren;
}) {
  return (
    <div class="pk-live-graphic-row" role="group" aria-label={`${name} controls`}>
      <div class="pk-live-graphic-row__name">
        <strong>{name}</strong>
        <span class="pk-live-graphic-row__detail" title={detail}>
          {detail}
        </span>
      </div>
      {settings ? (
        <Button
          icon
          variant="ghost"
          aria-label={settings.label}
          title={settings.label}
          disabled={settings.disabled}
          onClick={settings.onOpen}
        >
          <StrokeIcon>
            <path d="M2 4h12M2 8h12M2 12h12" />
            <path d="M5 2v4M11 6v4M7 10v4" />
          </StrokeIcon>
        </Button>
      ) : null}
      {children}
    </div>
  );
}
