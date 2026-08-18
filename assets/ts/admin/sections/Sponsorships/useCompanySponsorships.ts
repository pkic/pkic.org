import { useCallback, useEffect, useState } from "preact/hooks";
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

  const loadCompanySponsorships = useCallback(
    async (company: SponsorshipCompany, offset = 0) => {
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
          setCompanySponsorships([data.sponsorship]);
          setCompanyPage(null);
          setSelectedId(data.sponsorship.id);
          return;
        }
        const url = buildCompanySponsorshipsUrl(company.key, filters, offset);
        const data = await api<{ sponsorships: Sponsorship[]; page: CompanySponsorshipsPage }>(url);
        setCompanySponsorships((prev) => mergeCompanySponsorshipsPage(prev, offset, data).sponsorships);
        setCompanyPage(data.page);
        setSelectedId((prev) => {
          if (prev && data.sponsorships.some((s) => s.id === prev)) return prev;
          if (offset === 0) return data.page.total === 1 ? (data.sponsorships[0]?.id ?? null) : null;
          return prev;
        });
      } catch (e) {
        setCompanyError((e as Error).message);
      } finally {
        setCompanyLoading(false);
        setCompanyLoadingMore(false);
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
