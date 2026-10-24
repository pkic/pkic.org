import { isClientImportError, recoverClientImport } from "../../../shared/client-release-recovery";
import { Component, type ComponentChildren } from "preact";
import { usePortalHashLocation } from "../hash-location";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Button } from "../../../ui/Button";

interface RouteRenderState {
  error: Error | string | null;
  path: string;
}
class RouteRenderBoundary extends Component<{ children: ComponentChildren; path: string }, RouteRenderState> {
  state: RouteRenderState = { error: null, path: this.props.path };
  static getDerivedStateFromProps(props: { path: string }, state: RouteRenderState) {
    return props.path === state.path ? null : { error: null, path: props.path };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : String(error) };
  }
  componentDidCatch(error: unknown) {
    recoverClientImport(error);
  }
  render() {
    if (this.state.error === null) return this.props.children;
    const message = this.state.error instanceof Error ? this.state.error.message : this.state.error;
    const importFailure = isClientImportError(this.state.error);
    const error = importFailure
      ? "This page could not load. Check your connection, then reload the page. Save any unfinished work first."
      : message.includes("randomUUID")
        ? "This view requires a secure connection. Open this site using HTTPS, or use localhost on this computer. Native secure browser features are unavailable on this connection."
        : this.state.error;
    return (
      <section class="pk-stack" aria-label="Page recovery">
        <ErrorAlert error={error} />
        <Button onClick={() => (importFailure ? window.location.reload() : this.setState({ error: null }))}>
          {importFailure ? "Reload page" : "Try again"}
        </Button>
      </section>
    );
  }
}

/** Failed render or lazy import affects its view, never the persistent navigation. */
export function PortalRouteErrorBoundary({ children }: { children: ComponentChildren }) {
  const [path] = usePortalHashLocation();
  return <RouteRenderBoundary path={path}>{children}</RouteRenderBoundary>;
}
