import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { Button } from "../../../../ui/Button";
import { DataTable, type DataTableColumn } from "../../../../ui/DataTable";
import { EmptyState } from "../../../../ui/EmptyState";
import { Field } from "../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { RowActions } from "../../../../ui/RowActions";
import { Select, TextInput } from "../../../../ui/TextControl";
import { useApiPage } from "../../../../hooks/useApiPage";
import { deleteJson, getJson, patchJson, postJson } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { UserPicker, type PickedUser } from "../../../../components/UserPicker";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import {
  leadershipAffiliationsResponseSchema,
  leadershipPositionResponseSchema,
  leadershipPositionsListResponseSchema,
  type LeadershipAffiliation,
  type LeadershipPosition,
  type LeadershipPositionsListResponse,
} from "../../../../../shared/schemas/leadership";

const API_BASE = "/api/v1/leadership/positions";
const USER_CATALOG_ENDPOINT = "/api/v1/permissions/subjects";

/** ISO date -> "Jun 1, 2022" for display (starts_at/ends_at are date-only, no time component). */
function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The term as one phrase, so the column reads the same whether or not it has ended. */
function term(position: LeadershipPosition): string {
  return `${fmtDate(position.startsAt)} – ${position.endsAt ? fmtDate(position.endsAt) : "present"}`;
}

function AffiliationPicker({
  userId,
  initialValue,
  value,
  onChange,
}: {
  userId: string | null;
  initialValue: string | null | undefined;
  value: string | null | undefined;
  onChange: (identityId: string | null | undefined) => void;
}) {
  const [affiliations, setAffiliations] = useState<LeadershipAffiliation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAffiliations([]);
    if (!userId) {
      onChange(undefined);
      return;
    }

    setLoading(true);
    onChange(undefined);
    void getJson(`${API_BASE}/users/${encodeURIComponent(userId)}/affiliations`, leadershipAffiliationsResponseSchema)
      .then((data) => data.affiliations)
      .then((next) => {
        if (cancelled) return;
        setAffiliations(next);
        if (
          initialValue === null ||
          (initialValue !== undefined && next.some((item) => item.identityId === initialValue))
        ) {
          onChange(initialValue);
        } else if (next.length === 1) {
          onChange(next[0].identityId);
        } else if (next.length === 0) {
          onChange(null);
        }
      })
      .catch((error) => {
        if (!cancelled) toast((error as Error).message, "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, initialValue, onChange]);

  if (!userId) return null;

  return (
    <Field label="Membership affiliation">
      {(control) => (
        <Select
          {...control}
          value={value === undefined ? "" : (value ?? "none")}
          onChange={(event) => {
            const next = (event.target as HTMLSelectElement).value;
            onChange(next === "none" ? null : next || undefined);
          }}
          disabled={loading}
        >
          {value === undefined && <option value="">Select affiliation…</option>}
          <option value="none">No affiliation</option>
          {affiliations.map((affiliation) => (
            <option key={affiliation.identityId} value={affiliation.identityId}>
              {affiliation.organizationName ?? "Individual membership"} ({affiliation.membershipCategory})
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * The four values a position is made of, and the state behind them.
 *
 * The add form and the row's editor differ only in what they start from and
 * where they send it, so the fields and their state live here once rather
 * than as two copies that can drift apart. Every setter is a `useState`
 * setter, which matters: the affiliation lookup takes `onChange` as an effect
 * dependency, and an inline callback there would re-run the effect forever.
 */
function usePositionDraft(initial: LeadershipPosition | null) {
  const [identityId, setIdentityId] = useState<string | null | undefined>(initial ? initial.identityId : undefined);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [startsAt, setStartsAt] = useState(initial?.startsAt ?? "");
  const [endsAt, setEndsAt] = useState(initial?.endsAt ?? "");

  return {
    identityId,
    setIdentityId,
    title,
    setTitle,
    startsAt,
    setStartsAt,
    endsAt,
    setEndsAt,
    incomplete: identityId === undefined || !title.trim() || !startsAt,
    clear(): void {
      setIdentityId(undefined);
      setTitle("");
      setStartsAt("");
      setEndsAt("");
    },
  };
}

type PositionDraft = ReturnType<typeof usePositionDraft>;

function PositionFields({
  userId,
  initialIdentityId,
  draft,
  titlePlaceholder,
}: {
  userId: string | null;
  initialIdentityId: string | null | undefined;
  draft: PositionDraft;
  titlePlaceholder?: string;
}) {
  return (
    <>
      <AffiliationPicker
        userId={userId}
        initialValue={initialIdentityId}
        value={draft.identityId}
        onChange={draft.setIdentityId}
      />
      <Field label="Title" required>
        {(control) => (
          <TextInput
            {...control}
            placeholder={titlePlaceholder}
            value={draft.title}
            onInput={(e) => draft.setTitle((e.target as HTMLInputElement).value)}
          />
        )}
      </Field>
      <Field label="From" required>
        {(control) => (
          <TextInput
            {...control}
            type="date"
            value={draft.startsAt}
            onInput={(e) => draft.setStartsAt((e.target as HTMLInputElement).value)}
          />
        )}
      </Field>
      <Field label="Till" help="Leave blank for a current position.">
        {(control) => (
          <TextInput
            {...control}
            type="date"
            value={draft.endsAt}
            onInput={(e) => draft.setEndsAt((e.target as HTMLInputElement).value)}
          />
        )}
      </Field>
    </>
  );
}

function AddPositionForm({
  onAdded,
  body,
  label,
}: {
  onAdded: () => void;
  body: "board" | "executive_council";
  label: string;
}) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const draft = usePositionDraft(null);
  const [busy, setBusy] = useState(false);
  const incomplete = !picked || draft.incomplete;

  async function submit(e: Event) {
    e.preventDefault();
    if (busy || !picked || draft.incomplete) return;
    setBusy(true);
    try {
      await postJson(
        API_BASE,
        {
          body,
          userId: picked.id,
          identityId: draft.identityId,
          title: draft.title.trim(),
          startsAt: draft.startsAt,
          endsAt: draft.endsAt || null,
        },
        leadershipPositionResponseSchema,
      );
      toast("Position added", "success");
      setPicked(null);
      draft.clear();
      onAdded();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form class="pk-stack pk-stack--snug" aria-label={`Add a ${label} position`} onSubmit={(e) => void submit(e)}>
      <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={busy}>
        {/* The people search is several controls, so it is named by a legend
            rather than by a label with no single control to point at. */}
        <fieldset class="pk-fieldset pk-stack pk-stack--tight">
          <legend class="pk-field__label">Member</legend>
          <UserPicker
            endpoint={USER_CATALOG_ENDPOINT}
            value={picked}
            onChange={(user) => {
              setPicked(user);
              draft.setIdentityId(undefined);
            }}
            disabled={busy}
          />
        </fieldset>
        <PositionFields
          userId={picked?.id ?? null}
          initialIdentityId={undefined}
          draft={draft}
          titlePlaceholder="Board Member"
        />
      </fieldset>
      <div class="pk-cluster">
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={incomplete}>
          Add
        </Button>
      </div>
    </form>
  );
}

function PositionEditForm({
  position,
  onSaved,
  onCancel,
}: {
  position: LeadershipPosition;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const draft = usePositionDraft(position);
  const [busy, setBusy] = useState(false);

  async function save(e: Event) {
    e.preventDefault();
    if (busy || draft.incomplete) return;
    setBusy(true);
    try {
      await patchJson(
        `${API_BASE}/${encodeURIComponent(position.id)}`,
        {
          identityId: draft.identityId,
          title: draft.title.trim(),
          startsAt: draft.startsAt,
          endsAt: draft.endsAt || null,
        },
        leadershipPositionResponseSchema,
      );
      toast("Position updated", "success");
      onSaved();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      class="pk-stack pk-stack--snug"
      aria-label={`Edit ${position.name}'s position`}
      onSubmit={(e) => void save(e)}
    >
      <fieldset class="pk-fieldset pk-grid pk-grid--tight" disabled={busy}>
        <PositionFields userId={position.userId} initialIdentityId={position.identityId} draft={draft} />
      </fieldset>
      <div class="pk-cluster">
        <Button type="submit" size="sm" variant="primary" loading={busy} disabled={draft.incomplete}>
          Save
        </Button>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function PositionMenu({
  position,
  canGrant,
  canRevoke,
  onEdit,
  onChanged,
}: {
  position: LeadershipPosition;
  canGrant: boolean;
  canRevoke: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function remove() {
    const confirmed = await confirmAction({
      title: `Remove ${position.name} (${position.title})?`,
      consequences: [`${position.name} no longer appears in this list of leadership positions`],
      confirmLabel: "Remove position",
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      await deleteJson(`${API_BASE}/${encodeURIComponent(position.id)}`, successResponseSchema);
      toast("Position removed", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  const actions = [
    ...(canGrant ? [{ id: "edit", label: "Edit position", onSelect: onEdit, disabled: busy }] : []),
    ...(canRevoke ? [{ id: "remove", label: "Remove position", onSelect: () => void remove(), disabled: busy }] : []),
  ];
  if (actions.length === 0) return null;

  return <RowActions label={`Actions for ${position.name}`} actions={actions} />;
}

function positionColumns(
  canGrant: boolean,
  canRevoke: boolean,
  editId: string | null,
  setEditId: (id: string | null) => void,
  onChanged: () => void,
): ReadonlyArray<DataTableColumn<LeadershipPosition>> {
  return [
    { id: "name", header: "Name", cell: (position) => position.name },
    { id: "title", header: "Position", cell: (position) => position.title },
    {
      id: "represents",
      header: "Represents",
      cell: (position) => position.organizationName ?? "Individual membership",
    },
    { id: "term", header: "Term", cell: term, cellClass: "pk-nowrap" },
    {
      id: "actions",
      header: "Actions",
      headerHidden: true,
      align: "end",
      cell: (position) => (
        <PositionMenu
          position={position}
          canGrant={canGrant}
          canRevoke={canRevoke}
          onEdit={() => setEditId(editId === position.id ? null : position.id)}
          onChanged={onChanged}
        />
      ),
    },
  ];
}

function PositionsTable({
  caption,
  positions,
  loading,
  empty,
  canGrant,
  canRevoke,
  onChanged,
}: {
  caption: string;
  positions: readonly LeadershipPosition[];
  loading: boolean;
  empty: string;
  canGrant: boolean;
  canRevoke: boolean;
  onChanged: () => void;
}) {
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <DataTable
      caption={caption}
      showCaption
      columns={positionColumns(canGrant, canRevoke, editId, setEditId, onChanged)}
      rows={positions}
      rowKey={(position) => position.id}
      loading={loading}
      empty={<EmptyState title={empty} />}
      detailRow={(position) =>
        editId === position.id ? (
          <PositionEditForm
            position={position}
            onSaved={() => {
              setEditId(null);
              onChanged();
            }}
            onCancel={() => setEditId(null)}
          />
        ) : null
      }
    />
  );
}

export function LeadershipPositions({
  body,
  label,
  canGrant,
  canRevoke,
}: {
  body: "board" | "executive_council";
  label: string;
  canGrant: boolean;
  canRevoke: boolean;
}) {
  const currentPage = useApiPage<LeadershipPositionsListResponse>(
    API_BASE,
    {
      body,
      status: "current",
    },
    leadershipPositionsListResponseSchema,
    (data) => data.positions,
  );
  const pastPage = useApiPage<LeadershipPositionsListResponse>(
    API_BASE,
    {
      body,
      status: "past",
    },
    leadershipPositionsListResponseSchema,
    (data) => data.positions,
  );
  const current = currentPage.data?.positions ?? [];
  const past = pastPage.data?.positions ?? [];
  const reload = () => Promise.all([currentPage.reload(), pastPage.reload()]);
  const loadError = currentPage.error ?? pastPage.error;

  return (
    // The panel names itself, so a page holding both bodies announces two
    // regions rather than two unnamed sections.
    <Panel class="pk" aria-label={label}>
      <PanelHeader title={label} />
      <PanelBody class="pk-stack">
        {loadError ? (
          <ErrorAlert error={loadError instanceof Error ? loadError : "Could not load leadership positions."} />
        ) : !currentPage.data || !pastPage.data ? (
          <Spinner label={`Loading ${label.toLowerCase()}…`} />
        ) : (
          <>
            <PositionsTable
              caption={`Current ${label}`}
              positions={current}
              loading={currentPage.loading}
              empty="No current members"
              canGrant={canGrant}
              canRevoke={canRevoke}
              onChanged={() => void reload()}
            />
            {currentPage.pagerProps && <Pager {...currentPage.pagerProps} />}
            {canGrant && <AddPositionForm body={body} label={label} onAdded={() => void reload()} />}
            {past.length > 0 && (
              <div class="pk-stack pk-stack--snug">
                <PositionsTable
                  caption={`Past ${label}`}
                  positions={past}
                  loading={pastPage.loading}
                  empty="No past members"
                  canGrant={canGrant}
                  canRevoke={canRevoke}
                  onChanged={() => void reload()}
                />
                {pastPage.pagerProps && <Pager {...pastPage.pagerProps} />}
              </div>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
