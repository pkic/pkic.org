export const ADMIN_LIST_PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

function rangeText(offset: number, rowCount: number, total: number): string {
  if (total === 0) return "No results";
  return `${offset + 1}–${offset + rowCount} of ${total}`;
}

function pageItems(current: number, max: number): Array<number | "…"> {
  if (max <= 7) return Array.from({ length: max }, (_, i) => i + 1);
  const items: Array<number | "…"> = [1];
  const start = Math.max(2, current - 2);
  const end = Math.min(max - 1, current + 2);
  if (start > 2) items.push("…");
  for (let p = start; p <= end; p++) items.push(p);
  if (end < max - 1) items.push("…");
  items.push(max);
  return items;
}

export interface PagerProps {
  page: number;
  hasMore: boolean;
  pageSize: number;
  offset: number;
  rowCount: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onJump: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export function Pager({
  page,
  hasMore,
  pageSize,
  offset,
  rowCount,
  total,
  onPrev,
  onNext,
  onJump,
  onPageSizeChange,
}: PagerProps) {
  if (rowCount === 0 && !hasMore && offset === 0) return null;
  // A list that fits on the smallest page has nothing to paginate — but the
  // total is still worth stating. Keep the count, drop the page buttons and
  // page-size select.
  if (page <= 1 && !hasMore && total <= Math.min(...PAGE_SIZE_OPTIONS)) {
    return (
      <div class="d-flex justify-content-center mt-3 adm-pager">
        <span class="text-muted small adm-pager-range">{total === 1 ? "1 item" : `${total} items`}</span>
      </div>
    );
  }
  const max = total > 0 ? Math.ceil(total / pageSize) : page + (hasMore ? 1 : 0);

  return (
    <div class="d-flex align-items-center justify-content-center gap-2 flex-wrap mt-3 adm-pager">
      <span class="text-muted small adm-pager-range">{rangeText(offset, rowCount, total)}</span>
      <nav>
        <ul class="pagination pagination-sm mb-0">
          <li class={`page-item${page <= 1 ? " disabled" : ""}`}>
            <button class="page-link" onClick={onPrev} disabled={page <= 1}>
              &laquo;
            </button>
          </li>
          {pageItems(page, max).map((item, i) =>
            item === "…" ? (
              <li key={`e${i}`} class="page-item disabled">
                <span class="page-link">…</span>
              </li>
            ) : (
              <li key={item} class={`page-item${item === page ? " active" : ""}`}>
                <button class="page-link" onClick={() => onJump(item)}>
                  {item}
                </button>
              </li>
            ),
          )}
          <li class={`page-item${!hasMore ? " disabled" : ""}`}>
            <button class="page-link" onClick={onNext} disabled={!hasMore}>
              &raquo;
            </button>
          </li>
        </ul>
      </nav>
      <select
        class="form-select form-select-sm adm-pager-size"
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number((e.target as HTMLSelectElement).value))}
      >
        {PAGE_SIZE_OPTIONS.map((o) => (
          <option key={o} value={o}>
            {o} / page
          </option>
        ))}
      </select>
    </div>
  );
}
