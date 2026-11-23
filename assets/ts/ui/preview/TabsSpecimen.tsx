import { useHashQueryParam } from "../../hooks/useHashQueryParam";
import { TabList } from "../TabList";

/** Section tabs that fit, and a narrow location strip whose last rooms go into the More menu. */
export function TabsSpecimen() {
  const [active, setActive] = useHashQueryParam<string>("gallerySessionSection", "overview", [
    "overview",
    "speakers",
    "questions",
  ] as const);
  const [room, setRoom] = useHashQueryParam<string>("galleryLocation", "red", [
    "red",
    "blue",
    "shor",
    "heisenberg",
    "lovelace",
  ] as const);
  return (
    <div class="pk-stack">
      <TabList
        label="Session sections"
        activeId={active}
        onSelect={setActive}
        items={[
          { id: "overview", label: "Overview" },
          { id: "speakers", label: "Speakers" },
          { id: "questions", label: "Questions", attention: "2 unanswered" },
        ]}
      />
      <div class="pk-preview__narrow">
        <TabList
          label="Locations"
          activeId={room}
          onSelect={setRoom}
          items={[
            { id: "red", label: "Red hall" },
            { id: "blue", label: "Blue hall" },
            { id: "shor", label: "Room 2 – Shor" },
            { id: "heisenberg", label: "Room 8 – Heisenberg" },
            { id: "lovelace", label: "Room 9 – Lovelace" },
          ]}
        />
      </div>
    </div>
  );
}
