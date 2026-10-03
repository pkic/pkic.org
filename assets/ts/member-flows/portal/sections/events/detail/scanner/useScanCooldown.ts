import { useEffect, useRef, useState } from "preact/hooks";
import { ScanCooldownGate } from "./scan-cooldown";
export function useScanCooldown(durationMs = 600) {
  const gate = useRef(new ScanCooldownGate(durationMs));
  const [remainingMs, setRemaining] = useState(0);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    gate.current = new ScanCooldownGate(durationMs);
    setRemaining(0);
    setSaving(false);
  }, [durationMs]);
  useEffect(() => {
    if (remainingMs <= 0) return;
    const timer = window.setInterval(() => setRemaining(gate.current.remaining()), 50);
    return () => window.clearInterval(timer);
  }, [remainingMs > 0]);
  return {
    remainingMs,
    saving,
    durationMs,
    ready() {
      return gate.current.ready();
    },
    accept() {
      if (!gate.current.accept()) return false;
      setSaving(true);
      setRemaining(0);
      return true;
    },
    feedback() {
      gate.current.feedback();
      setSaving(false);
      setRemaining(gate.current.remaining());
    },
    skip() {
      gate.current.skip();
      setRemaining(gate.current.remaining());
    },
    reset() {
      gate.current.reset();
      setSaving(false);
      setRemaining(0);
    },
  };
}
