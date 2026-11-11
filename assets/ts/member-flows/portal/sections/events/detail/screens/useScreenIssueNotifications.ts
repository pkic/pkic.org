/**
 * An opt-in browser notification for staff while the Screens tab or the
 * studio is open: once when a screen enters a critical issue, and once when
 * it has fully recovered. Nothing is pushed by the server and no service
 * worker is involved; closing the page stops it. The choice is kept in this
 * browser only.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { screenIssueSeverity, type ScreenIssue } from "../../../../../../../shared/event-screen-issues";
import { toast } from "../../../../ui";

const PREFERENCE_KEY = "pkic.screens.notify";

export const screenNotificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

function readPreference(): boolean {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

function writePreference(on: boolean): void {
  try {
    if (on) localStorage.setItem(PREFERENCE_KEY, "1");
    else localStorage.removeItem(PREFERENCE_KEY);
  } catch {
    /* Private browsing: the choice lasts this page only. */
  }
}

function notify(title: string, body: string, tag: string): void {
  try {
    new Notification(title, { body, tag });
  } catch {
    /* Some browsers allow notifications only from a service worker; this page then stays quiet. */
  }
}

export function useScreenIssueNotifications({
  issues,
  nameOf,
  ready = true,
}: {
  /** Every screen's current issues, by screen ID. */
  issues: ReadonlyMap<string, readonly ScreenIssue[]>;
  nameOf: (screenId: string) => string;
  /** The issues reflect the monitor's snapshot; until then nothing counts, not even as already known. */
  ready?: boolean;
}) {
  const [enabled, setEnabled] = useState(
    () => screenNotificationsSupported() && readPreference() && Notification.permission === "granted",
  );
  /** Screens announced as critical and not yet announced as recovered; null until the first look. */
  const announced = useRef<Set<string> | null>(null);
  const name = useRef(nameOf);
  name.current = nameOf;
  const current = useRef(issues);
  current.current = issues;

  const toggle = useCallback(async () => {
    if (enabled) {
      setEnabled(false);
      writePreference(false);
      return;
    }
    if (!screenNotificationsSupported()) {
      toast("This browser cannot show notifications.", "error");
      return;
    }
    const permission =
      Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") {
      toast("Notifications are blocked for this site. Allow them in your browser's site settings.", "error");
      return;
    }
    setEnabled(true);
    writePreference(true);
  }, [enabled]);

  const signature = [...issues]
    .map(([screenId, list]) => `${screenId}:${screenIssueSeverity(list) ?? ""}:${list[0]?.label ?? ""}`)
    .join("|");
  useEffect(() => {
    // Without a current snapshot nothing counts; the next one is looked at afresh, as when the page opened.
    if (!ready) {
      announced.current = null;
      return;
    }
    const issues = current.current;
    const critical = [...issues].filter(([, list]) => screenIssueSeverity(list) === "critical");
    // What is already wrong when the page opens is not news; its recovery is.
    if (announced.current === null) {
      announced.current = new Set(critical.map(([screenId]) => screenId));
      return;
    }
    for (const [screenId, list] of critical) {
      if (announced.current.has(screenId)) continue;
      announced.current.add(screenId);
      if (enabled) notify(`${name.current(screenId)}: ${list[0]!.label}`, "This screen needs attention.", screenId);
    }
    for (const screenId of [...announced.current]) {
      const list = issues.get(screenId);
      if (list && list.length) continue;
      announced.current.delete(screenId);
      if (enabled && list) notify(`${name.current(screenId)} is back to normal`, "No issues left.", screenId);
    }
    // The signature carries every change that matters here.
  }, [signature, enabled, ready]);

  return { supported: screenNotificationsSupported(), enabled, toggle };
}
