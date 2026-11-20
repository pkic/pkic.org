import { useEffect, useRef, useState, type MutableRef } from "preact/hooks";
import type { EligibilityManifest } from "./eligibility-manifest";

/** One attendee name stays in memory until staff explicitly advance. */
export function useBadgeCollection(
  enabled: boolean,
  manifest: MutableRef<EligibilityManifest | null>,
  scope: string,
  preserveOnHidden?: () => boolean,
) {
  const held = useRef(false);
  const preserve = useRef(preserveOnHidden);
  preserve.current = preserveOnHidden;
  const request = useRef(0);
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);
  function clear() {
    request.current++;
    held.current = false;
    setWaiting(false);
    setName(null);
    setLoading(false);
    setCredential(null);
  }
  function begin(credential: string) {
    if (!enabled) return;
    held.current = true;
    setWaiting(true);
    setCredential(credential);
    setName(null);
    setLoading(true);
    const current = ++request.current;
    void Promise.resolve(manifest.current?.lookupName?.(credential) ?? null)
      .then((value) => {
        if (request.current === current) setName(value);
      })
      .catch(() => {
        // A name lookup cannot change the durable check-in outcome.
      })
      .finally(() => {
        if (request.current === current) setLoading(false);
      });
    if (!manifest.current) setLoading(false);
  }
  useEffect(() => {
    clear();
    return clear;
  }, [enabled, scope]);
  useEffect(() => {
    function hideName() {
      if (document.visibilityState !== "hidden") return;
      if (preserve.current?.()) return;
      request.current++;
      setName(null);
      setLoading(false);
      setCredential(null);
    }
    document.addEventListener("visibilitychange", hideName);
    return () => document.removeEventListener("visibilitychange", hideName);
  }, []);
  function display(onNext: () => void, saving: boolean, print?: (credential: string) => void, showName = true) {
    return {
      waiting,
      name,
      loading,
      showName,
      saving,
      onNext,
      onPrint: credential && print ? () => print(credential) : undefined,
    };
  }
  return { held, waiting, name, loading, credential, begin, clear, display };
}
