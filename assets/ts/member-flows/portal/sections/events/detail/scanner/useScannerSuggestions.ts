import { useEffect, useRef, useState } from "preact/hooks";
import {
  scannerSuggestionsResponseSchema,
  type ScannerSuggestion,
  type ScannerSuggestionsResponse,
} from "../../../../../../../shared/schemas/event-scanner-suggestions";
import { requestJson } from "../../../../../../shared/api-client";

/** Multiple compatible duties can recommend the same physical check-in target. */
function distinctTargets(suggestions: ScannerSuggestion[]) {
  const targets = new Map<string, ScannerSuggestion>();
  for (const suggestion of suggestions) {
    const key = JSON.stringify([suggestion.occurrence.id, suggestion.suggestedRoomId]);
    const previous = targets.get(key);
    targets.set(
      key,
      previous ? { ...previous, roles: [...new Set([...previous.roles, ...suggestion.roles])] } : suggestion,
    );
  }
  return [...targets.values()];
}
export function useScannerSuggestions({
  slug,
  operatorUserId,
  enabled,
  explicitTarget,
  ready,
  locked,
  onChoose,
}: {
  slug: string;
  operatorUserId: string;
  enabled: boolean;
  explicitTarget: boolean;
  ready: boolean;
  locked: boolean;
  onChoose: (suggestion: ScannerSuggestion) => void;
}) {
  const scope = `${slug}:${operatorUserId}`;
  const provenance = useRef({ scope, manual: false, considered: false });
  if (provenance.current.scope !== scope) provenance.current = { scope, manual: false, considered: false };
  const latest = useRef({ scope, ready, locked, onChoose });
  latest.current = { scope, ready, locked, onChoose };
  const [response, setResponse] = useState<{ scope: string; data: ScannerSuggestionsResponse } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setResponse(null);
    void requestJson(`/api/v1/events/${encodeURIComponent(slug)}/scans/suggestions`, scannerSuggestionsResponseSchema, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    })
      .then((data) => {
        if (!controller.signal.aborted && latest.current.scope === scope) setResponse({ scope, data });
      })
      .catch(() => {
        if (!controller.signal.aborted && latest.current.scope === scope)
          setError("Duty suggestions are unavailable. Choose a session manually.");
      })
      .finally(() => {
        if (!controller.signal.aborted && latest.current.scope === scope) setLoading(false);
      });
    return () => controller.abort();
  }, [slug, operatorUserId, enabled, refresh]);
  const data = enabled && response?.scope === scope ? response.data : null;
  const suggestions = data ? distinctTargets(data.suggestions) : [];
  useEffect(() => {
    if (!data || !ready || provenance.current.considered) return;
    provenance.current.considered = true;
    if (
      explicitTarget ||
      provenance.current.manual ||
      latest.current.locked ||
      data.truncated ||
      suggestions.length !== 1
    )
      return;
    const candidate = suggestions[0]!;
    if ((candidate.occurrence.rooms?.length ?? 0) > 1 && !candidate.suggestedRoomId) return;
    latest.current.onChoose(candidate);
  }, [data, ready, locked, explicitTarget]);
  return {
    suggestions,
    timeZone: data?.timeZone,
    truncated: data?.truncated ?? false,
    loading: enabled && loading,
    error: enabled ? error : "",
    manual: () => {
      provenance.current.manual = true;
    },
    choose: (suggestion: ScannerSuggestion) => {
      if (latest.current.locked || !latest.current.ready) return;
      provenance.current.manual = true;
      latest.current.onChoose(suggestion);
    },
    refresh: () => {
      if (!latest.current.locked) setRefresh((value) => value + 1);
    },
  };
}
