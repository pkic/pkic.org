import { useMembershipCategoryCatalog } from "./useMembershipCategoryCatalog";

/** Resolve category labels through the same catalog used by membership and group forms. */
export function useMembershipCategoryLabels(enabled = true): {
  label: (code: string | null | undefined) => string;
} {
  const categories = useMembershipCategoryCatalog(enabled);
  return {
    label: (code) => {
      if (!code) return "";
      const category = categories.find((entry) => entry.code === code);
      return category ? `${category.label} (${code})` : `Category ${code}`;
    },
  };
}
