import type { ScannerRole } from "./scanner-role";
import { createContext } from "preact";
import { useContext, useEffect, useRef } from "preact/hooks";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";

export type ScannerTask = "entry" | "exit" | "print";
export interface ScannerTaskDestination {
  key: ScannerTask;
  label: string;
  href: string;
  action?: EventScanRequest["action"];
}
interface ScannerTaskNavigation {
  launch: ScannerTask | null;
  gradientFrom?: ScannerRole;
  tasks: readonly ScannerTaskDestination[];
  onLaunch: (task: ScannerTask, from?: ScannerRole) => void;
  onConsumed: () => void;
}
/** Routes own tasks; a swipe carries only a transient request to start full screen. */
export const ScannerTaskNavigation = createContext<ScannerTaskNavigation | null>(null);

export function useScannerTaskLaunch(task: "scan" | "print", onLaunch: () => void) {
  const navigation = useContext(ScannerTaskNavigation);
  const launch = navigation?.launch;
  const consume = navigation?.onConsumed;
  const latest = useRef(onLaunch);
  latest.current = onLaunch;
  useEffect(() => {
    if (launch && (task === "print" ? launch === "print" : launch !== "print")) {
      latest.current();
      consume?.();
    }
  }, [launch, consume, task]);
}

export function useScannerTaskSwipe(current: ScannerTask, role: ScannerRole = current) {
  const navigation = useContext(ScannerTaskNavigation);
  return {
    tasks: navigation?.tasks ?? [],
    move: (direction: "left" | "right") => {
      if (!navigation || navigation.tasks.length < 2) return;
      const index = navigation.tasks.findIndex((task) => task.key === current);
      if (index < 0) return;
      const next = (index + (direction === "left" ? 1 : -1) + navigation.tasks.length) % navigation.tasks.length;
      navigation.onLaunch(navigation.tasks[next]!.key, role);
    },
  };
}
