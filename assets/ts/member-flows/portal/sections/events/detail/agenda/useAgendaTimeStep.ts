import { useEffect, useState } from "preact/hooks";
import { agendaTimeSteps } from "./schedule-time-controls";

/** An event-scoped display preference shared by the calendar and scheduling settings. */
export function useAgendaTimeStep(eventSlug: string) {
  const key = `agenda.time-step:${eventSlug}`;
  function read() {
    try {
      return agendaTimeSteps.find((step) => step === Number(sessionStorage.getItem(key))) ?? 5;
    } catch {
      return 5;
    }
  }
  const [timeStep, setValue] = useState<number>(read);
  useEffect(() => setValue(read()), [eventSlug]);
  function setTimeStep(minutes: number) {
    const next = agendaTimeSteps.find((step) => step === minutes);
    if (next === undefined) return;
    setValue(next);
    try {
      sessionStorage.setItem(key, String(next));
    } catch {
      // The calendar still supports this preference when browser storage is unavailable.
    }
  }
  return { timeStep, setTimeStep };
}
