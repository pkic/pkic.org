/**
 * One contract form split across `TabList` panels.
 *
 * A long editor reads better when the essentials stand alone and the rest
 * waits behind named tabs, but it is still one form with one Save: every
 * panel stays mounted (hidden, not removed) so switching tabs never loses
 * input, and the form keeps submitting the whole body.
 *
 * The hook adds only what tabs take away. A tab whose fields carry a visible
 * contract or server refusal is marked through `TabList`'s attention badge,
 * and after a refused submit `revealErrors()` selects the first marked tab
 * and moves focus to its first refused control — the one `useContractForm`
 * could not focus while its panel was hidden.
 *
 * Usage:
 *   const tabs = useFormTabs(form, [
 *     { id: "main", label: "Session", fields: ["title", "startAt"] },
 *     { id: "access", label: "Participation", fields: ["capacity"] },
 *   ]);
 *   <TabList label="Session sections" {...tabs.list} />
 *   <div {...tabs.panel("main")}>…</div>
 *   // After form.submit() or form.refuse(error) fails:
 *   tabs.revealErrors();
 */
import { useEffect, useId, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import type { ContractForm } from "./useContractForm";
import type { TabListItem } from "../ui/TabList";

export interface FormTab<Id extends string> {
  id: Id;
  label: ComponentChildren;
  /** Contract field names (or name prefixes) edited on this tab. */
  fields: ReadonlyArray<string>;
}

export function useFormTabs<Id extends string>(
  form: Pick<ContractForm<unknown>, "errorsWithin">,
  tabs: ReadonlyArray<FormTab<Id>>,
  initial: Id = tabs[0]!.id,
) {
  const prefix = `pk-form-tabs-${useId()}`;
  const [active, setActive] = useState<Id>(initial);
  const [reveal, setReveal] = useState(0);
  const [focusAt, setFocusAt] = useState(0);
  const invalid = new Set(
    tabs.filter((tab) => tab.fields.some((field) => form.errorsWithin(field).length > 0)).map((tab) => tab.id),
  );
  const panelId = (id: Id) => `${prefix}-panel-${id}`;

  useEffect(() => {
    if (!reveal) return;
    const first = tabs.find((tab) => invalid.has(tab.id));
    if (!first) return;
    setActive(first.id);
    setFocusAt(reveal);
  }, [reveal]);

  // Runs after the selected panel is shown, so its refused control can take focus.
  useEffect(() => {
    if (!focusAt) return;
    document.getElementById(panelId(active))?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusAt]);

  const items: TabListItem[] = tabs.map((tab) => ({
    id: tab.id,
    label: tab.label,
    panelId: panelId(tab.id),
    attention: invalid.has(tab.id) ? "Needs attention" : undefined,
  }));

  return {
    active,
    select: setActive,
    /** Spread on `TabList` together with its `label`. */
    list: {
      items,
      activeId: active,
      idPrefix: prefix,
      onSelect: (id: string) => {
        const tab = tabs.find((item) => item.id === id);
        if (tab) setActive(tab.id);
      },
    },
    /** Spread on each panel's container; hidden panels stay mounted. */
    panel: (id: Id) => ({
      id: panelId(id),
      role: "tabpanel" as const,
      "aria-labelledby": `${prefix}-${id}`,
      hidden: active !== id,
    }),
    /** Call after a refused submit: shows the first tab with a refused field. */
    revealErrors: () => setReveal(Date.now()),
  };
}
