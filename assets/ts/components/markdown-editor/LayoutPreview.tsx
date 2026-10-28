import type { MarkdownLayoutKind } from "../../../shared/schemas/markdown-layout";

/** A decorative schematic distinguishes flowing text, independent items, and card arrangements. */
export function LayoutPreview({
  kind,
  count = 2,
  top = false,
}: {
  kind: Exclude<MarkdownLayoutKind, "table">;
  count?: number;
  top?: boolean;
}) {
  return (
    <svg class="pk-layout-preview" viewBox="0 0 72 48" aria-hidden="true" focusable="false">
      {kind === "bento" ? (
        top ? (
          <>
            <rect x="2" y="2" width="68" height="20" rx="2" />
            <rect x="2" y="27" width="31" height="19" rx="2" />
            <rect x="39" y="27" width="31" height="19" rx="2" />
          </>
        ) : (
          <>
            <rect x="2" y="2" width="43" height="44" rx="2" />
            <rect x="50" y="2" width="20" height="20" rx="2" />
            <rect x="50" y="27" width="20" height="19" rx="2" />
          </>
        )
      ) : (
        Array.from({ length: count }, (_, column) => {
          const width = (68 - (count - 1) * 5) / count;
          const x = 2 + column * (width + 5);
          return kind === "columns" ? (
            <g key={column}>
              {Array.from({ length: 6 }, (_, line) => (
                <path key={line} d={`M${x} ${4 + line * 7}h${width}`} />
              ))}
            </g>
          ) : (
            <g key={column}>
              {[2, 27].map((y) => (
                <g key={y}>
                  <rect x={x} y={y} width={width} height="19" rx={kind === "cards" ? "2" : "0"} />
                  {kind === "cards" && (
                    <>
                      <path d={`M${x + 3} ${y + 6}h${Math.max(2, width - 6)}`} />
                      <path d={`M${x + 3} ${y + 11}h${Math.max(2, width - 10)}`} />
                    </>
                  )}
                </g>
              ))}
            </g>
          );
        })
      )}
    </svg>
  );
}
