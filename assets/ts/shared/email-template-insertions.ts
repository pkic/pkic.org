import type { MenuItem } from "../ui/Menu";
import { TEMPLATE_HELPERS, type TemplateHelperItem } from "./email-template-helpers";
import { EMAIL_PARTIALS, type EmailPartial } from "../../shared/email-partials";

export function subjectTemplateInsertions(
  onInsert: (snippet: string) => void,
  isAvailable: (item: TemplateHelperItem) => boolean = () => true,
): MenuItem[] {
  return TEMPLATE_HELPERS.filter((item) => item.category === "Variables" && isAvailable(item)).map((item) => ({
    id: item.label,
    label: item.label,
    onSelect: () => onInsert(item.snippet),
  }));
}

export function bodyTemplateInsertions(
  onInsert: (snippet: string) => void,
  isHelperAvailable: (item: TemplateHelperItem) => boolean = () => true,
  isPartialAvailable: (partial: EmailPartial) => boolean = () => true,
): MenuItem[] {
  const helpers = TEMPLATE_HELPERS.filter(isHelperAvailable).map((item) => ({
    id: item.label,
    label: item.label,
    onSelect: () => onInsert(item.snippet),
  }));
  const partials = EMAIL_PARTIALS.filter(isPartialAvailable).map((partial, index) => ({
    id: `partial-${partial.name}`,
    label: `${partial.name} — ${partial.description}`,
    separatorBefore: index === 0,
    onSelect: () => onInsert(`{{> ${partial.name}}}`),
  }));
  return [...helpers, ...partials];
}
