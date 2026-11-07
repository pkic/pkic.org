import { useEffect, useRef } from "preact/hooks";
import { useScannerPreferences } from "./useScannerPreferences";
import { useScannerAudio } from "./useScannerAudio";

/** A print tone confirms preparation, never claims that physical printing succeeded. */
export function usePrintScannerSound(job: string | undefined, busy: boolean, error: string) {
  const preferences = useScannerPreferences();
  const audio = useScannerAudio(preferences.sound, "print");
  const heard = useRef<string>();
  const play = useRef(audio.play);
  play.current = audio.play;
  useEffect(() => {
    if (job && !busy && !error && heard.current !== job) {
      heard.current = job;
      play.current("print");
    }
  }, [job, busy, error]);
  useEffect(() => {
    if (error) play.current("error");
  }, [error]);
  return { ...audio, toggleSound: () => audio.toggle(preferences.setSound) };
}
