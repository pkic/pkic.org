import { createContext, type ComponentChildren } from "preact";
import { useCallback, useContext, useId, useLayoutEffect, useMemo, useState } from "preact/hooks";
import { Breadcrumb, type BreadcrumbItem } from "./Breadcrumb";

import "./BreadcrumbScope.scss";

type Trail = ReadonlyArray<BreadcrumbItem>;
type Entry = { route: string; items: Trail };
type Scope = { route: string; items: Trail; register: (id: string, entry: Entry) => () => void };
const TrailContext = createContext<Scope | null>(null);

/** One visible trail; loaded descendants contribute their actual record names. */
export function BreadcrumbScope({
  route,
  items,
  label,
  children,
}: {
  route: string;
  items: Trail;
  label: string;
  children: ComponentChildren;
}) {
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const register = useCallback((id: string, entry: Entry) => {
    setEntries((previous) => ({ ...previous, [id]: entry }));
    return () =>
      setEntries((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
  }, []);
  const serialized = JSON.stringify(items);
  const value = useMemo(
    () => ({ route, items: JSON.parse(serialized) as Trail, register }),
    [route, serialized, register],
  );
  const current = Object.values(entries)
    .filter((entry) => entry.route === route)
    .reduce((trail, entry) => (entry.items.length > trail.length ? entry.items : trail), items);
  return (
    <TrailContext.Provider value={value}>
      <Breadcrumb items={current} label={label} />
      {children}
    </TrailContext.Provider>
  );
}

/** Extend the current trail and pass that full ancestry to deeper records. */
export function BreadcrumbBranch({ items, children }: { items: Trail; children?: ComponentChildren }) {
  const parent = useContext(TrailContext);
  const id = useId();
  const serialized = JSON.stringify(items);
  const value = useMemo(
    () =>
      parent
        ? {
            ...parent,
            items: [...parent.items, ...(JSON.parse(serialized) as Trail)],
          }
        : null,
    [parent, serialized],
  );
  useLayoutEffect(() => {
    if (!value) return;
    return value.register(id, { route: value.route, items: value.items });
  }, [id, value]);
  return <TrailContext.Provider value={value}>{children}</TrailContext.Provider>;
}
