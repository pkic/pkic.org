import "./DataTable.css";

/** A short, aligned code followed by a label that can ellipsize within a table. */
export function TableCodedLabel({
  code,
  name,
  title,
  wideCode = false,
  className,
}: {
  code: string | null | undefined;
  name: string;
  title?: string;
  wideCode?: boolean;
  className?: string;
}) {
  if (!code)
    return (
      <span class={["pk-table__clamp", className].filter(Boolean).join(" ")} title={title ?? name}>
        {name}
      </span>
    );

  return (
    <span
      class={["pk-table__coded-label", wideCode && "pk-table__coded-label--wide", className].filter(Boolean).join(" ")}
      title={title ?? name}
    >
      <span class="pk-table__coded-label__code">{code}</span>
      <span class="pk-table__coded-label__separator" aria-hidden="true">
        |
      </span>
      <span class="pk-table__coded-label__name">{name}</span>
    </span>
  );
}
