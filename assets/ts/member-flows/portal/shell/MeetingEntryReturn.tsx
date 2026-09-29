import { useEffect } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";

export function MeetingEntryReturn({ destination }: { destination: string }) {
  useEffect(() => {
    window.location.replace(destination);
  }, [destination]);
  return <Spinner label="Returning to your meeting…" />;
}
