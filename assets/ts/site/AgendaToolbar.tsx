import type { ComponentChildren } from "preact";
import type { ContentAgendaDay } from "../../shared/site-agenda";
import { formatNumber } from "../../shared/format-number";
import { GridListToggle } from "../ui/GridListToggle";
import "../ui/Toolbar.css";
import { Button } from "../ui/Button";
import { IconChevron, IconFilter, StrokeIcon } from "../ui/MediaIcons";
import { PreferenceStar } from "../ui/PreferenceStar";
import { Field } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { AgendaFilters } from "./AgendaFilters";

/**
 * The agenda toolbar: filters, then reading and view actions. Public and portal agendas add the phone Filters
 * toggle, print and the view choice; the organizer editor supplies its own actions instead.
 */
export function AgendaToolbar({
  days,
  editor,
  editorControls,
  editorNotice,
  personal,
}: {
  days: readonly ContentAgendaDay[];
  editor: boolean;
  editorControls?: ComponentChildren;
  /** The organizer editor's status line, on its own row under the actions. */
  editorNotice?: ComponentChildren;
  /** Portal-only: the signed-in viewer's toolbar actions and My agenda filter, which My agenda itself leaves out. */
  personal?: { toolbarControls?: ComponentChildren; mineOnly?: boolean; mineCount: number };
}) {
  return (
    <div class="pk-content-agenda__controls pk-toolbar-row" data-agenda-controls hidden>
      <div class="pk-toolbar__search">
        <Field label="Search sessions or speakers" labelHidden>
          {(control) => (
            <TextInput {...control} type="search" data-agenda-search placeholder="Search sessions or speakers" />
          )}
        </Field>
      </div>
      <AgendaFilters days={days} id="agenda-filter-controls" />
      <div class="pk-content-agenda__toolbar-actions">
        {
          <Button
            variant="secondary"
            aria-label="Filter sessions"
            title="Filter sessions"
            data-agenda-filters-toggle
            aria-controls="agenda-filter-controls"
            aria-expanded="true"
          >
            <IconFilter />
            <span class="pk-toolbar-control-label">Filters</span>
            <small data-agenda-filters-count hidden />
          </Button>
        }
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
                {!personal.mineOnly && (
                  <Button
                    data-agenda-mine-filter
                    aria-pressed="false"
                    title="Show only starred and registered sessions"
                  >
                    <PreferenceStar selected />
                    <span>My agenda</span>
                    <small>{formatNumber(personal.mineCount)}</small>
                  </Button>
                )}
              </>
            )}
            <GridListToggle
              value="grid"
              label="Agenda view"
              class="pk-content-agenda__view-choice"
              gridProps={{ "data-agenda-view": "grid" }}
              listProps={{ "data-agenda-view": "list" }}
            />
          </>
        )}
        {editorControls && <div data-agenda-editor-controls>{editorControls}</div>}
        <div class="pk-toolbar-compact-actions" data-agenda-secondary-menu />
      </div>
      {editorNotice}
    </div>
  );
}
