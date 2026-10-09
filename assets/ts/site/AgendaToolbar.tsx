import type { ComponentChildren } from "preact";
import type { ContentAgendaDay } from "../../shared/site-agenda";
import { formatNumber } from "../../shared/format-number";
import { Button } from "../ui/Button";
import { IconChevron, IconFilter, StrokeIcon } from "../ui/MediaIcons";
import { PreferenceStar } from "../ui/PreferenceStar";
import { AgendaFilters } from "./AgendaFilters";

/**
 * The agenda toolbar: filters, then reading and view actions. Public and portal agendas add the phone Filters
 * toggle, print and the view choice; the organizer editor supplies its own actions instead.
 */
export function AgendaToolbar({
  days,
  editor,
  editorControls,
  personal,
}: {
  days: readonly ContentAgendaDay[];
  editor: boolean;
  editorControls?: ComponentChildren;
  /** Portal-only: the signed-in viewer's toolbar actions and My agenda filter. */
  personal?: { toolbarControls?: ComponentChildren; mineFilter?: boolean; mineCount: number };
}) {
  return (
    <div class="pk-content-agenda__controls" data-agenda-controls hidden>
      <AgendaFilters days={days} id={editor ? undefined : "agenda-filter-controls"} />
      <div class="pk-content-agenda__toolbar-actions">
        {!editor && (
          <Button
            variant="secondary"
            data-agenda-filters-toggle
            aria-controls="agenda-filter-controls"
            aria-expanded="true"
          >
            <IconFilter />
            <span>Filters</span>
            <small data-agenda-filters-count hidden />
          </Button>
        )}
        <Button
          variant="secondary"
          icon
          data-agenda-scroll="-1"
          aria-label="Scroll agenda left"
          title="Scroll agenda left"
        >
          <IconChevron pointing="left" />
        </Button>
        <Button
          variant="secondary"
          icon
          data-agenda-scroll="1"
          aria-label="Scroll agenda right"
          title="Scroll agenda right"
        >
          <IconChevron pointing="right" />
        </Button>
        <Button
          variant="secondary"
          data-agenda-compact
          aria-pressed="true"
          aria-label="Hide session descriptions"
          title="Hide session descriptions"
        >
          <StrokeIcon>
            <path d="m4 2 4 4 4-4M4 14l4-4 4 4" />
          </StrokeIcon>
          <span>Abstracts</span>
        </Button>
        <Button
          variant="secondary"
          icon
          data-agenda-expand
          aria-pressed="false"
          aria-expanded="false"
          aria-label="Expand agenda"
          title="Expand agenda"
        >
          <StrokeIcon>
            <path d="M2 6V2h4m4 0h4v4M2 10v4h4m4 0h4v-4" />
          </StrokeIcon>
        </Button>
        {!editor && (
          <>
            <Button icon data-agenda-print aria-label="Print agenda" title="Print or save agenda as PDF">
              <StrokeIcon>
                <path d="M4 6V2h8v4M4 12H2V6h12v6h-2M4 10h8v4H4z" />
              </StrokeIcon>
            </Button>
            {personal && (
              <>
                {personal.toolbarControls}
                <Button
                  data-agenda-mine-filter
                  aria-pressed={personal.mineFilter ? "true" : "false"}
                  title="Show only starred and registered sessions"
                >
                  <PreferenceStar selected />
                  <span>My agenda</span>
                  <small>{formatNumber(personal.mineCount)}</small>
                </Button>
              </>
            )}
            <div class="pk-content-agenda__view-choice" role="group" aria-label="Agenda view">
              <Button data-agenda-view="grid" aria-pressed="true">
                Grid
              </Button>
              <Button data-agenda-view="list" aria-pressed="false">
                List
              </Button>
            </div>
          </>
        )}
        {editorControls}
      </div>
    </div>
  );
}
