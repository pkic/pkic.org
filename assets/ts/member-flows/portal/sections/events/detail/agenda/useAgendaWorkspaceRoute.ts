import { useRouteView } from "../../../../../../hooks/useRouteView";
import { splitHash, writeUrlQuery } from "../../../../../../ui/url-query";
import { agendaWorkspaceViews, type AgendaWorkspaceView } from "./AgendaWorkspaceHeader";

/** Planner days and workspace views have one canonical route owner. */
export function useAgendaWorkspaceRoute(days: ReadonlyArray<{ date: string }>) {
  const current = splitHash();
  const basePath = current.path.replace(/\/agenda(?:\/.*)?\/?$/, "/agenda");
  const dates = days.map((day) => day.date);
  const legacyView = /\/agenda\/revisions\/(review|preview)\/?$/.test(current.path)
    ? "revisions"
    : (agendaWorkspaceViews.find((value) => value === current.params.get("view")) ?? "agenda");
  const [selected, select] = useRouteView(basePath, [...agendaWorkspaceViews, ...dates], legacyView);
  const view = agendaWorkspaceViews.find((value) => value === selected) ?? "agenda";
  const storedDay = current.params.get("agendaDay");
  const day = dates.find((date) => date === selected) ?? dates.find((date) => date === storedDay) ?? dates[0] ?? "";
  const setDay = (date: string) => {
    if (dates.includes(date)) select(date);
  };
  const setView = (next: AgendaWorkspaceView, revisionView?: "review" | "preview") => {
    if (!agendaWorkspaceViews.includes(next)) return;
    const params = new URLSearchParams(current.params);
    if (agendaWorkspaceViews.some((value) => value === params.get("view"))) params.delete("view");
    if (next === "agenda") params.delete("agendaDay");
    else if (day) params.set("agendaDay", day);
    writeUrlQuery({
      source: "hash",
      ownerPath: current.path,
      destinationPath:
        next === "agenda"
          ? `${basePath}${day ? `/${day}` : ""}`
          : `${basePath}/${next}${next === "revisions" && revisionView === "preview" ? "/preview" : ""}`,
      params,
      mode: "push",
    });
  };
  return { view, day, setView, setDay };
}
