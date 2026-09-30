import { IconBadge } from "../../ui/Badge";
import { IconSource } from "../icons";
import { IconMicrophone, IconPeople, IconTools } from "../icons/indicators";

/** Event-defined types retain their exact label, including unfamiliar custom types. */
export function ProposalTypeIcon({ type }: { type: string }) {
  const key = type.toLowerCase();
  const Icon =
    key === "talk" || key === "presentation" || key === "keynote"
      ? IconMicrophone
      : key === "panel" || key === "discussion"
        ? IconPeople
        : key === "workshop" || key === "tutorial"
          ? IconTools
          : IconSource;
  return <IconBadge label={type} icon={<Icon />} />;
}
