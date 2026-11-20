/**
 * Codes: a code gives its holder one ticket at a set price for a limited
 * number of uses. Creating one is a quick action, so it is a dialog.
 */
import { useState, type MutableRef } from "preact/hooks";
import { patchJson, postJson } from "../../../../../../../shared/api-client";
import { successResponseSchema } from "../../../../../../../../shared/schemas/api-common";
import { type EventTicketsConfiguration } from "../../../../../../../../shared/schemas/event-tickets";
import {
  eventTicketCodeCreateResponseSchema,
  eventTicketCodeCreateSchema,
  eventTicketCodeListSchema,
  type EventTicketCode,
} from "../../../../../../../../shared/schemas/event-ticket-codes";
import { formatTicketAmount, parseTicketAmount } from "../../../../../../../../shared/event-ticket-display";
import { formatNumber } from "../../../../../../../../shared/format-number";
import { ApiDataTable, type ApiTableActions } from "../../../../../../../components/ApiDataTable";
import { confirmAction } from "../../../../../../../components/ConfirmDialog";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import type { CollectionLoader } from "../../../../../../../hooks/useServerCollection";
import { copyText } from "../../../../../../../shared/clipboard";
import { toast } from "../../../../../ui";
import { Alert } from "../../../../../../../ui/Alert";
import { Badge } from "../../../../../../../ui/Badge";
import { Radio } from "../../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../../ui/Dialog";
import { EmptyState } from "../../../../../../../ui/EmptyState";
import { Field } from "../../../../../../../ui/Field";
import { Panel, PanelHeader } from "../../../../../../../ui/Panel";
import { RowActions } from "../../../../../../../ui/RowActions";
import { Select, TextInput } from "../../../../../../../ui/TextControl";
import { ticketsEndpoint } from "./tickets-endpoint";

/** Shown in groups of four so it can be read aloud; typed with or without the dashes. */
export function displayTicketCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

function codePrice(code: EventTicketCode, currency: string): string {
  return code.percentOff !== null ? `${code.percentOff}% off` : formatTicketAmount(code.amount ?? 0, currency);
}

export function TicketCodesPanel({
  slug,
  configuration,
  canWrite,
  table,
  loadCodes,
}: {
  slug: string;
  configuration: EventTicketsConfiguration;
  canWrite: boolean;
  /** Lets the tab reload the list when codes are made elsewhere on it, such as sponsor passes. */
  table: MutableRef<ApiTableActions | null>;
  /** Replaces the request for the codes, where there is no server to ask. */
  loadCodes?: CollectionLoader;
}) {
  const { currency } = configuration.settings;
  const tickets = configuration.types.filter((type) => type.active);
  const [open, setOpen] = useState(false);
  const [ticketTypeId, setTicketTypeId] = useState(tickets[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [discount, setDiscount] = useState<"amount" | "percent">("amount");
  const [amount, setAmount] = useState("0");
  const [percent, setPercent] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(eventTicketCodeCreateSchema, {
    ticketTypeId,
    label,
    discount,
    amount: discount === "amount" ? (parseTicketAmount(amount, currency) ?? undefined) : undefined,
    percentOff: discount === "percent" && percent.trim() !== "" ? Number(percent) : undefined,
    maxUses: maxUses.trim() === "" ? undefined : Number(maxUses),
  });
  const notify = toast;
  function close() {
    setOpen(false);
    setLabel("");
    setAmount("0");
    setPercent("");
    setMaxUses("");
    setDiscount("amount");
    setError("");
    form.reset();
  }
  async function create() {
    if (saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      const created = await postJson(
        `${ticketsEndpoint(slug)}/codes`,
        checked.data,
        eventTicketCodeCreateResponseSchema,
      );
      await table.current?.reload();
      close();
      await copyText(displayTicketCode(created.code.code), {
        copied: "Code created and copied.",
        failed: "Code created. Copy it from the list.",
        notify,
      });
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  async function change(code: EventTicketCode, body: { addUses?: number; revoked?: boolean }, done: string) {
    try {
      await patchJson(`${ticketsEndpoint(slug)}/codes/${encodeURIComponent(code.id)}`, body, successResponseSchema);
      await table.current?.reload();
      notify(done, "success");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "The code could not be changed. Try again.", "error");
    }
  }
  const ticketName = (id: string) => configuration.types.find((type) => type.id === id)?.name ?? "";
  return (
    <Panel aria-label="Codes">
      <PanelHeader title="Codes" />
      <ApiDataTable
        urlState="ticket-codes"
        endpoint={`${ticketsEndpoint(slug)}/codes`}
        responseSchema={eventTicketCodeListSchema}
        resolve={(value) => value.codes}
        resolvePage={(value) => value.page}
        load={loadCodes}
        actionsRef={table}
        caption="Codes"
        paginate
        searchPlaceholder="Search codes…"
        initialSort="-created"
        createAction={
          canWrite && tickets.length > 0 ? { label: "Create code", onSelect: () => setOpen(true) } : undefined
        }
        rowKey={(row) => row.id}
        empty={
          <EmptyState
            title="No codes to show"
            body="A code gives its holder one ticket at a set price: sponsor passes, partner discounts, or a free place on request."
          />
        }
        columns={[
          {
            header: "Code for",
            hideable: false,
            sort: { asc: "label", desc: "-label" },
            cell: (row) => (
              <>
                <strong>{row.label}</strong>
                <div class="pk-small pk-muted">{displayTicketCode(row.code)}</div>
              </>
            ),
          },
          { header: "Ticket", width: "fit", cell: (row) => ticketName(row.ticketTypeId) },
          { header: "Price", width: "fit", align: "end", cell: (row) => codePrice(row, currency) },
          {
            header: "Used",
            width: "fit",
            align: "end",
            sort: { asc: "used", desc: "-used" },
            cell: (row) => `${formatNumber(row.usedCount)} of ${formatNumber(row.maxUses)}`,
          },
          {
            // No header: the table names the actions column itself.
            header: "",
            hideable: false,
            width: "fit",
            align: "end",
            cell: (row) => (
              <RowActions
                subject={row.label}
                status={row.revokedAt ? <Badge tone="danger">Revoked</Badge> : undefined}
                actions={[
                  {
                    id: "copy",
                    label: "Copy code",
                    onSelect: () =>
                      void copyText(displayTicketCode(row.code), {
                        copied: "Code copied.",
                        failed: "The code could not be copied. Select it in the list.",
                        notify,
                      }),
                  },
                  ...(canWrite
                    ? [
                        {
                          id: "more",
                          label: "Add 10 uses",
                          onSelect: () => void change(row, { addUses: 10 }, "10 uses added."),
                        },
                        row.revokedAt
                          ? {
                              id: "restore",
                              label: "Restore code",
                              onSelect: () => void change(row, { revoked: false }, "Code restored."),
                            }
                          : {
                              id: "revoke",
                              label: "Revoke code",
                              onSelect: () =>
                                void confirmAction({
                                  title: `Revoke the code for ${row.label}?`,
                                  body: "Nobody can register with it anymore. Tickets already issued with it stay valid.",
                                  confirmLabel: "Revoke code",
                                  tone: "danger",
                                }).then((confirmed) =>
                                  confirmed ? change(row, { revoked: true }, "Code revoked.") : undefined,
                                ),
                            },
                      ]
                    : []),
                ]}
              />
            ),
          },
        ]}
      />
      <Dialog
        open={open}
        title="Create code"
        confirmLabel="Create code"
        confirmDisabled={saving}
        onConfirm={() => void create()}
        onCancel={close}
      >
        <form
          noValidate
          class="pk-stack"
          {...form.handlers}
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            void create();
          }}
        >
          <Field
            {...form.of("label")}
            label="Who it is for"
            help="For your own reference, such as a sponsor's name."
            required
          >
            {(control) => (
              <TextInput
                {...control}
                name="label"
                value={label}
                onInput={(event) => setLabel(event.currentTarget.value)}
              />
            )}
          </Field>
          <Field {...form.of("ticketTypeId")} label="Ticket" required>
            {(control) => (
              <Select {...control} name="ticketTypeId" onChange={(event) => setTicketTypeId(event.currentTarget.value)}>
                {tickets.map((type) => (
                  <option key={type.id} value={type.id} selected={type.id === ticketTypeId}>
                    {type.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field {...form.ofGroup("discount")} label="Price with this code" group required>
            {() => (
              <div class="pk-stack pk-stack--tight">
                <Radio
                  name="discount"
                  value="amount"
                  checked={discount === "amount"}
                  label="A set price"
                  hint="Enter 0 for a free ticket."
                  onChange={() => setDiscount("amount")}
                />
                <Radio
                  name="discount"
                  value="percent"
                  checked={discount === "percent"}
                  label="A percentage off"
                  hint="Taken off the ticket's price on the day it is used."
                  onChange={() => setDiscount("percent")}
                />
              </div>
            )}
          </Field>
          {discount === "amount" ? (
            <Field {...form.of("amount")} label={`Price (${currency.toUpperCase()})`} required>
              {(control) => (
                <TextInput
                  {...control}
                  name="amount"
                  inputMode="decimal"
                  value={amount}
                  onInput={(event) => setAmount(event.currentTarget.value)}
                />
              )}
            </Field>
          ) : (
            <Field {...form.of("percentOff")} label="Percentage off" required>
              {(control) => (
                <TextInput
                  {...control}
                  name="percentOff"
                  type="number"
                  inputMode="numeric"
                  value={percent}
                  onInput={(event) => setPercent(event.currentTarget.value)}
                />
              )}
            </Field>
          )}
          <Field
            {...form.of("maxUses")}
            label="Number of uses"
            help="How many people can register with it. You can add more later."
            required
          >
            {(control) => (
              <TextInput
                {...control}
                name="maxUses"
                type="number"
                inputMode="numeric"
                value={maxUses}
                onInput={(event) => setMaxUses(event.currentTarget.value)}
              />
            )}
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </form>
      </Dialog>
    </Panel>
  );
}
