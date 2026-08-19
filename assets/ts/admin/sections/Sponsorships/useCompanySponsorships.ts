import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../../api";
import type { Sponsorship, SponsorshipCompany } from "../../types";
import {
  buildCompanySponsorshipsUrl,
  mergeCompanySponsorshipsPage,
  type CompanySponsorshipsPage,
} from "./companySponsorshipsPage";

/**
 * Company drill-down state: companies → that company's sponsorships →
 * sponsorship detail (2026-07-30 testing feedback — see index.tsx's header
 * comment for the full rationale). Company grouping/sorting/pagination
 * happens in D1 via `/companies` (`listSponsorshipCompanies`); this hook
 * only fetches the selected company's rows, one server-paginated page at a
 * time, with an explicit "Load more" rather than a single capped fetch
 * rendered as complete (PR #1 review, Phase 7.2).
 */
export function useCompanySponsorships(filters: { type: string; stage: string }) {
  const [selectedCompany, setSelectedCompany] = useState<SponsorshipCompany | null>(null);
  const [companySponsorships, setCompanySponsorships] = useState<Sponsorship[]>([]);
  const [companyPage, setCompanyPage] = useState<CompanySponsorshipsPage | null>(null);
  const [companyLoading, setCompanyLoading] = useState(false);
  const [companyLoadingMore, setCompanyLoadingMore] = useState(false);
  const [companyError, setCompanyError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Request-generation guard (Phase 7 line-by-line review, P7-R01): "Load
  // more" and a type/stage filter change can both be in flight at once, and
  // their responses can land out of order — e.g. an offset-0 refetch from a
  // filter change resolves before an earlier "Load more" page, then that
  // stale page arrives and appends onto the wrong (now-superseded) filtered
  // set. Every call bumps this counter and captures its own id; a response
  // is only applied if the counter still matches, i.e. no newer call has
  // started since. Loading flags are reset unconditionally per-call (each
  // call owns the flag it set), so a superseded request can't leave a
  // spinner stuck on.
  const requestIdRef = useRef(0);

  const loadCompanySponsorships = useCallback(
    async (company: SponsorshipCompany, offset = 0) => {
      const requestId = ++requestIdRef.current;
      if (offset === 0) {
        setCompanyLoading(true);
        setCompanyError(null);
      } else {
        setCompanyLoadingMore(true);
      }
      try {
        if (company.key.startsWith("sponsorship:")) {
          const id = company.key.slice("sponsorship:".length);
          const data = await api<{ sponsorship: Sponsorship }>(`/api/v1/admin/sponsorships/${id}`);
          if (requestId !== requestIdRef.current) return;
          setCompanySponsorships([data.sponsorship]);
          setCompanyPage(null);
          setSelectedId(data.sponsorship.id);
          return;
        }
        const url = buildCompanySponsorshipsUrl(company.key, filters, offset);
        const data = await api<{ sponsorships: Sponsorship[]; page: CompanySponsorshipsPage }>(url);
        if (requestId !== requestIdRef.current) return;
        setCompanySponsorships((prev) => mergeCompanySponsorshipsPage(prev, offset, data).sponsorships);
        setCompanyPage(data.page);
        setSelectedId((prev) => {
          if (prev && data.sponsorships.some((s) => s.id === prev)) return prev;
          if (offset === 0) return data.page.total === 1 ? (data.sponsorships[0]?.id ?? null) : null;
          return prev;
        });
      } catch (e) {
        if (requestId === requestIdRef.current) setCompanyError((e as Error).message);
      } finally {
        if (offset === 0) setCompanyLoading(false);
        else setCompanyLoadingMore(false);
      }
    },
    [filters.type, filters.stage],
  );

  function selectCompany(company: SponsorshipCompany) {
    setSelectedCompany(company);
    void loadCompanySponsorships(company);
  }

  function loadMore() {
    if (!selectedCompany || !companyPage?.hasMore || companyLoadingMore) return;
    void loadCompanySponsorships(selectedCompany, companySponsorships.length);
  }

  function backToCompanies() {
    setSelectedCompany(null);
    setCompanySponsorships([]);
    setCompanyPage(null);
    setSelectedId(null);
  }

  function reload() {
    if (selectedCompany) void loadCompanySponsorships(selectedCompany);
  }

  // Filters apply to the currently-open company too, not just the list.
  // Deliberately keyed on [type, stage] only, not selectedCompany — this
  // should refetch when filters change, not every time a new company is
  // selected (selectCompany already triggers that fetch itself).
  useEffect(() => {
    if (selectedCompany) void loadCompanySponsorships(selectedCompany);
  }, [filters.type, filters.stage]);

  return {
    selectedCompany,
    companySponsorships,
    companyPage,
    companyLoading,
    companyLoadingMore,
    companyError,
    selectedId,
    setSelectedId,
    selectCompany,
    loadMore,
    backToCompanies,
    reload,
  };
}
