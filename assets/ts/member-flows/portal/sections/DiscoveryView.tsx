import { useHashQueryParam } from "../../../hooks/useHashQueryParam";
import { GridListToggle } from "../../../ui/GridListToggle";
import "./DiscoveryView.css";

export function useDiscoveryView() {
  const [value, setView] = useHashQueryParam("view", "grid");
  const view: "grid" | "list" = value === "list" ? "list" : "grid";
  return { view, setView };
}

export function DiscoveryViewToggle({
  view,
  onChange,
}: {
  view: "grid" | "list";
  onChange: (view: "grid" | "list") => void;
}) {
  return <GridListToggle value={view} onChange={onChange} />;
}
