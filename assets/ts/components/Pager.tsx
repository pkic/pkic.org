/**
 * The portal's pager, rendered by the design system's.
 *
 * The portal thinks in offsets, because that is what its list endpoints take;
 * the design system thinks in page numbers, because that is what a reader
 * clicks. This translates between them in one place.
 *
 * Two behaviours are kept from the version this replaces, because they are
 * about what to show rather than how it looks:
 *
 *   - A list with nothing in it and nothing after it renders no pager. There
 *     is no page to go to.
 *   - A list that fits on the smallest page keeps its count and drops the
 *     controls. "12 items" is useful; a single page button beside it is not.
 */
import { Pager as SystemPager } from "../ui/Pager";

export const ADMIN_LIST_PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

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

export function Pager({ page, hasMore, pageSize, offset, rowCount, total, onJump, onPageSizeChange }: PagerProps) {
  if (rowCount === 0 && !hasMore && offset === 0) return null;

  if (page <= 1 && !hasMore && total <= Math.min(...PAGE_SIZE_OPTIONS)) {
    return <p class="pk pk-small pk-center">{total === 1 ? "1 item" : `${total} items`}</p>;
  }

  // Without a total the server has only told us whether there is more, so the
  // page count is "this one, and one more if there is more".
  const pageCount = total > 0 ? Math.ceil(total / pageSize) : page + (hasMore ? 1 : 0);

  return (
    <div class="pk">
      <SystemPager
        page={page}
        pageCount={pageCount}
        total={total}
        rangeStart={total === 0 ? 0 : offset + 1}
        rangeEnd={offset + rowCount}
        onSelect={onJump}
        pageSize={{ value: pageSize, options: PAGE_SIZE_OPTIONS, onChange: onPageSizeChange }}
      />
    </div>
  );
}
