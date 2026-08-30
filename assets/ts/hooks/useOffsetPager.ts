import { useCallback, useState } from "preact/hooks";
import { ADMIN_LIST_PAGE_SIZE_DEFAULT, type PagerProps } from "../components/Pager";

export interface OffsetPageInfo {
  hasMore: boolean;
  rowCount: number;
  total: number;
  serverOffset?: number;
}

/** Canonical state controller for offset-paginated API collections. */
export function useOffsetPager(initialPageSize = ADMIN_LIST_PAGE_SIZE_DEFAULT, initialOffset = 0) {
  const normalizedInitialPageSize =
    Number.isInteger(initialPageSize) && initialPageSize > 0 ? initialPageSize : ADMIN_LIST_PAGE_SIZE_DEFAULT;
  const [offset, setOffset] = useState(Number.isInteger(initialOffset) && initialOffset > 0 ? initialOffset : 0);
  const [pageSize, setPageSize] = useState(normalizedInitialPageSize);
  const page = pageSize > 0 ? Math.floor(offset / pageSize) + 1 : 1;

  const resetPage = useCallback(() => {
    setOffset(0);
  }, []);

  const resetAll = useCallback(() => {
    setOffset(0);
    setPageSize(normalizedInitialPageSize);
  }, [normalizedInitialPageSize]);

  function pagerProps({ hasMore, rowCount, total, serverOffset = offset }: OffsetPageInfo): PagerProps {
    const responsePage = pageSize > 0 ? Math.floor(serverOffset / pageSize) + 1 : 1;
    const maxPage = total > 0 ? Math.max(1, Math.ceil(total / pageSize)) : responsePage + (hasMore ? 1 : 0);
    return {
      page: responsePage,
      hasMore,
      pageSize,
      offset: serverOffset,
      rowCount,
      total,
      onPrev: () => setOffset((current) => Math.max(0, current - pageSize)),
      onNext: () => {
        if (hasMore) setOffset((current) => current + pageSize);
      },
      onJump: (nextPage: number) => {
        if (!Number.isFinite(nextPage)) return;
        const boundedPage = Math.min(maxPage, Math.max(1, Math.trunc(nextPage)));
        setOffset((boundedPage - 1) * pageSize);
      },
      onPageSizeChange: (size: number) => {
        if (!Number.isInteger(size) || size <= 0) return;
        setPageSize(size);
        resetPage();
      },
    };
  }

  return { offset, pageSize, page, resetPage, resetAll, pagerProps };
}
