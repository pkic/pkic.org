import { useState } from "preact/hooks";
import { ADMIN_LIST_PAGE_SIZE_DEFAULT } from "../components/Pager";

/**
 * Manages server-side pagination state.
 * Pages are 1-indexed (page 1 = first page, matching what Pager renders).
 */
export function usePageState() {
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(ADMIN_LIST_PAGE_SIZE_DEFAULT);

  const page = pageSize > 0 ? Math.floor(offset / pageSize) + 1 : 1;

  function resetPage() {
    setOffset(0);
  }

  function resetAll() {
    setOffset(0);
    setPageSize(ADMIN_LIST_PAGE_SIZE_DEFAULT);
  }

  function pagerProps(rowCount: number, total: number, hasMore: boolean) {
    return {
      page,
      hasMore,
      pageSize,
      offset,
      rowCount,
      total,
      onPrev: () => setOffset((o) => Math.max(0, o - pageSize)),
      onNext: () => setOffset((o) => o + pageSize),
      onJump: (p: number) => setOffset((p - 1) * pageSize),
      onPageSizeChange: (s: number) => {
        setPageSize(s);
        setOffset(0);
      },
    };
  }

  return { offset, pageSize, page, resetPage, resetAll, pagerProps };
}
