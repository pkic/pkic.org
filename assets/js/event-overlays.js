import {
  getHashParams,
  resolveDayTime,
  parseOffsetToSeconds,
  getSpeakersForTime,
  getNextAgendaSlot,
  getSpeakersData,
  getSessionSpeakerGroups,
  parseTime,
  formatSecondsAsTime,
  getAgendaData,
  createIncrementalSearchBuffer,
  handleSearchOrNumericShortcut,
  initializeEventDisplay,
} from "./event-common.js";

const svgTemplate = `
<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2500 417" width="100%">
    <title>Lower Third Title</title>

    <path id="Title BG" class="s0" d="m2484 233v184h-1929v-184z"/>
    <path id="Name BG" class="s1" d="m2331 6v228h-1949.5l-19.9-138.3-109.6-89.7z"/>
    <text id="Name" transform="translate(482 160)">
         <tspan x="0" y="0" class="t2">Fullname</tspan>
    </text>
    <text id="Title" transform="translate(625 310)">
         <tspan id="TitleLine1" x="0" y="0" class="t3">Title Line 1</tspan>
         <tspan id="TitleLine2" x="0" y="80" class="t3">Title Line 2</tspan>
    </text>
    <g id="Element">
         <path id="Bottom" class="s4" d="M238.89 372.277C228.093 390.99 225.977 416.818 201.84 416.818C177.703 416.818 175.587 390.99 164.79 372.277A187.916 187.916 0 0 1 70.81 322.747L89.356 305.216A162.421 162.421 0 0 0 314.324 305.216L332.87 322.747A187.916 187.916 0 0 1 238.89 372.277Z"/>
         <path id="Right" class="s5" d="M342.86 63.85C364.464 63.844 387.891 52.762 399.959 73.666C412.028 94.569 390.717 109.316 379.91 128.023A187.916 187.916 0 0 1 384.006 234.177L359.551 226.881A162.421 162.421 0 0 0 247.067 32.053L252.976 7.226A187.916 187.916 0 0 1 342.86 63.85Z"/>
         <path id="Left" class="s6" d="M23.77 128.023C12.963 109.316 -8.348 94.569 3.721 73.666C15.789 52.762 39.216 63.844 60.82 63.85A187.916 187.916 0 0 1 150.704 7.226L156.613 32.053A162.421 162.421 0 0 0 44.129 226.881L19.674 234.177A187.916 187.916 0 0 1 23.77 128.023Z"/>
         <path id="Table" fill-rule="evenodd" class="s1" d="M214.581 60.919A127.768 127.768 0 0 1 318.309 240.582L370.95 270.974L358.209 293.042L305.569 262.65A127.768 127.768 0 0 1 98.111 262.65L45.471 293.042L32.73 270.974L85.371 240.582A127.768 127.768 0 0 1 189.099 60.919L189.099 0.134L214.581 0.134ZM201.84 85.763A102.287 102.287 0 0 0 201.84 290.337A102.287 102.287 0 0 0 201.84 85.763Z"/>
         <path id="Keyhole" class="s1" d="M187.723 182.519L170.062 250.873L233.618 250.873L215.957 182.519A30.389 30.389 0 1 0 187.723 182.519Z"/>
    </g>
</svg>
`;

const ViewMode = {
  CURRENT: "current", // Current session speakers
  NEXT: "next", // Next session speakers
  ALL: "all", // All speakers (no filters)
};

let filteredSpeakers = [];
let nextSpeakers = [];
let allSpeakers = [];
let speakers = [];
let currentSpeakerIndex = 0;
let autoUpdateEnabled = false;
let viewMode = ViewMode.CURRENT;
let nextSlotInfo = null;
let sessionOffset = 0; // Track how many sessions forward/backward we've navigated
let allSessionSlots = []; // Store all available session slots

const incrementalSearch = createIncrementalSearchBuffer();
let debugOverlay = null;

function createDebugOverlay() {
  if (debugOverlay) {
    return;
  }

  debugOverlay = document.createElement("div");
  debugOverlay.id = "debug-overlay";
  document.body.appendChild(debugOverlay);
}

function updateDebugOverlay() {
  const params = getHashParams();
  if (!params.debug || params.debug === "0" || params.debug === "false") {
    if (debugOverlay) {
      debugOverlay.remove();
      debugOverlay = null;
    }
    return;
  }

  createDebugOverlay();

  const { time } = resolveDayTime(params);
  const startOffsetSeconds = parseOffsetToSeconds(params.startOffset);
  const currentTimeSeconds = time ? parseTime(time) : null;
  const adjustedTimeSeconds = currentTimeSeconds !== null ? currentTimeSeconds + startOffsetSeconds : null;

  const currentSlot = sessionOffset === 0 && allSessionSlots.length > 0 ? allSessionSlots[0] : null;
  const activeSlot =
    sessionOffset > 0 && sessionOffset <= allSessionSlots.length ? allSessionSlots[sessionOffset - 1] : currentSlot;

  const prevSlot = sessionOffset > 0 && allSessionSlots[sessionOffset - 2] ? allSessionSlots[sessionOffset - 2] : null;
  const nextSlot =
    sessionOffset < allSessionSlots.length && allSessionSlots[sessionOffset] ? allSessionSlots[sessionOffset] : null;

  // Get session titles
  const getSessionTitle = (slot) => {
    if (!slot) return null;
    const groups = getSessionSpeakerGroups({
      day: slot.day,
      time: slot.time,
      location: params.location,
    });
    return groups.length > 0 ? groups[0].session?.title : null;
  };

  const prevSessionTitle = getSessionTitle(prevSlot);
  const currentSessionTitle = getSessionTitle(activeSlot);
  const nextSessionTitle = getSessionTitle(nextSlot);

  const shortcuts = speakers
    .slice(0, 10)
    .map((speaker, index) => `${index === currentSpeakerIndex ? "▶ " : "  "}[${(index + 1) % 10}] ${speaker.name}`);
  const sessionLabel = (slot, title) => (slot ? `${slot.day} ${slot.time}${title ? ` — ${title}` : ""}` : "None");
  debugOverlay.textContent = [
    "DEBUG OVERLAY",
    `View mode: ${viewMode.toUpperCase()}`,
    `Session offset: ${sessionOffset} of ${allSessionSlots.length}`,
    `Speakers: ${speakers.length} (showing ${speakers.length ? currentSpeakerIndex + 1 : 0}/${speakers.length})`,
    `Current time: ${time || "N/A"}`,
    `Start offset: ${params.startOffset || "0"} (${startOffsetSeconds}s)`,
    `Adjusted time: ${adjustedTimeSeconds !== null ? formatSecondsAsTime(adjustedTimeSeconds).substring(0, 5) : "N/A"}`,
    "",
    `Previous session: ${sessionLabel(prevSlot, prevSessionTitle)}`,
    `Current session: ${sessionLabel(activeSlot, currentSessionTitle)}`,
    `Next session: ${sessionLabel(nextSlot, nextSessionTitle)}`,
    "",
    "Speaker shortcuts (0–9):",
    ...(shortcuts.length ? shortcuts : ["No speakers available"]),
    "",
    "←→ Speakers · ↑↓ Sessions · 0–9 Select · a–z Search",
    "Space: All · Ctrl+Space: Freeze · Escape: Reset",
  ].join("\n");
}

function buildAllSessionSlots() {
  // Build a list of all session time slots in chronological order
  const params = getHashParams();
  const { day } = resolveDayTime(params);
  const agendaData = getAgendaData();
  const slots = [];

  const dayKeys = Object.keys(agendaData);
  const startIndex = dayKeys.indexOf(day);

  if (startIndex === -1) {
    return [];
  }

  // Get all slots from the starting day onwards
  for (let i = startIndex; i < dayKeys.length; i++) {
    const dayKey = dayKeys[i];
    const dayAgenda = agendaData[dayKey] || [];

    dayAgenda.forEach((agendaSlot) => {
      if (agendaSlot.sessions && agendaSlot.sessions.length > 0) {
        slots.push({
          day: dayKey,
          time: agendaSlot.time,
        });
      }
    });
  }

  return slots;
}

function navigateToSessionOffset(offset) {
  sessionOffset = offset;

  if (sessionOffset === 0) {
    // Return to current session
    viewMode = ViewMode.CURRENT;
    synchronizeSpeakers({ preserveSelection: false });
    showNameAndTitle();
    console.log(`Session navigation: CURRENT (offset 0)`);
    return;
  }

  // Get the session at the specified offset
  if (sessionOffset > 0 && sessionOffset <= allSessionSlots.length) {
    const targetSlot = allSessionSlots[sessionOffset - 1];

    console.log(`Session navigation: Moving to session +${sessionOffset}`, targetSlot);

    const params = getHashParams();
    const targetSpeakers = getSpeakersForTime({
      day: targetSlot.day,
      time: targetSlot.time,
      location: params.location,
    });

    // Temporarily use filteredSpeakers to show this session
    filteredSpeakers = targetSpeakers;
    viewMode = ViewMode.CURRENT;
    synchronizeSpeakers({ preserveSelection: false });
    showNameAndTitle();

    console.log(`Showing session at ${targetSlot.day} ${targetSlot.time} (${targetSpeakers.length} speakers)`);
  } else {
    // Offset out of range
    console.log(`Session offset ${sessionOffset} out of range (max: ${allSessionSlots.length})`);
    sessionOffset = Math.max(0, Math.min(sessionOffset, allSessionSlots.length));
  }
}

function getSpeakersListForMode(mode) {
  switch (mode) {
    case ViewMode.CURRENT:
      return filteredSpeakers;
    case ViewMode.NEXT:
      return nextSpeakers;
    case ViewMode.ALL:
    default:
      return allSpeakers;
  }
}

function clampIndex(index, list) {
  if (!list.length) {
    return 0;
  }
  return Math.max(0, Math.min(index, list.length - 1));
}

function synchronizeSpeakers({ preserveSelection = true } = {}) {
  const previousName = preserveSelection && speakers[currentSpeakerIndex] ? speakers[currentSpeakerIndex].name : null;
  speakers = getSpeakersListForMode(viewMode) || [];

  if (!speakers.length) {
    currentSpeakerIndex = 0;
    return;
  }

  if (previousName) {
    const preservedIndex = speakers.findIndex((speaker) => speaker.name === previousName);
    currentSpeakerIndex = preservedIndex !== -1 ? preservedIndex : clampIndex(currentSpeakerIndex, speakers);
  } else {
    currentSpeakerIndex = clampIndex(currentSpeakerIndex, speakers);
  }
}

function announceViewMode() {
  const count = speakers.length;
  let message = `View mode: ${viewMode.toUpperCase()} (${count} speaker${count === 1 ? "" : "s"})`;

  if (viewMode === ViewMode.CURRENT && filteredSpeakers.length > 0) {
    const params = getHashParams();
    const { day, time } = resolveDayTime(params);
    const groups = getSessionSpeakerGroups({
      day,
      time,
      location: params.location,
      startOffsetSeconds: parseOffsetToSeconds(params.startOffset),
      endOffsetSeconds: parseOffsetToSeconds(params.endOffset),
    });
    if (groups.length > 0) {
      const bestGroup = groups[0]; // selectBestGroup would pick this
      message += ` – Session: "${bestGroup.session?.title}" at ${day} ${time}`;
    }
  } else if (viewMode === ViewMode.NEXT && nextSlotInfo) {
    const dayText = nextSlotInfo.day ? `${nextSlotInfo.day} ` : "";
    const groups = getSessionSpeakerGroups({
      day: nextSlotInfo.day,
      time: nextSlotInfo.time,
    });
    if (groups.length > 0) {
      message += ` – Session: "${groups[0].session?.title}" at ${dayText}${nextSlotInfo.time}`;
    } else {
      message += ` – Next slot ${dayText}${nextSlotInfo.time}`;
    }
  }

  console.log(message);
}

function setViewMode(targetMode, { preserveSelection = true, announce = true, show = true } = {}) {
  if (!Object.values(ViewMode).includes(targetMode)) {
    return;
  }

  const previousMode = viewMode;
  viewMode = targetMode;

  if (viewMode !== ViewMode.CURRENT) {
    autoUpdateEnabled = false;
  }

  synchronizeSpeakers({ preserveSelection });

  if (announce && (previousMode !== viewMode || show)) {
    announceViewMode();
  }

  if (show) {
    showNameAndTitle();
  }
}

function findSpeakerIndexInList(list, query) {
  if (!list || !list.length) {
    return -1;
  }

  const lowerQuery = query.toLowerCase();
  const passes = [(name) => name.startsWith(lowerQuery), (name) => name.includes(lowerQuery)];

  for (const predicate of passes) {
    let index = list.findIndex((speaker, idx) => idx > currentSpeakerIndex && predicate(speaker.name.toLowerCase()));
    if (index !== -1) {
      return index;
    }
    index = list.findIndex((speaker) => predicate(speaker.name.toLowerCase()));
    if (index !== -1) {
      return index;
    }
  }

  return -1;
}

function setSpeakerIndex(index, { fromUser = false } = {}) {
  if (!speakers.length) {
    currentSpeakerIndex = 0;
    showNameAndTitle();
    return;
  }

  currentSpeakerIndex = clampIndex(index, speakers);

  if (fromUser) {
    autoUpdateEnabled = false;
  }

  showNameAndTitle();
}

function handleSearchKey(key) {
  const character = key.toLowerCase();
  const searchBuffer = incrementalSearch.append(character);

  // ONLY search within the current speaker list (current group)
  const inCurrentList = findSpeakerIndexInList(speakers, searchBuffer);
  if (inCurrentList !== -1) {
    setSpeakerIndex(inCurrentList, { fromUser: true });
    return;
  }

  console.log(`No speaker match for "${searchBuffer}" in current group (${viewMode})`);
}

function updateNameAndTitle() {
  const params = getHashParams();
  const { day, time, autoUpdate } = resolveDayTime(params);

  if (autoUpdate) {
    autoUpdateEnabled = true;
  }

  // Reset session navigation when updating
  sessionOffset = 0;

  const startOffsetSeconds = parseOffsetToSeconds(params.startOffset);
  const endOffsetSeconds = parseOffsetToSeconds(params.endOffset);

  const currentTimeSeconds = time ? parseTime(time) : null;
  const adjustedTimeSeconds = currentTimeSeconds !== null ? currentTimeSeconds + startOffsetSeconds : null;

  console.log("[updateNameAndTitle] Fetching CURRENT session speakers", {
    day,
    time,
    currentTimeSeconds,
    startOffset: params.startOffset,
    startOffsetSeconds,
    adjustedTimeSeconds,
    adjustedTimeFormatted: adjustedTimeSeconds !== null ? formatSecondsAsTime(adjustedTimeSeconds) : "N/A",
    endOffsetSeconds,
  });

  // Calculate adjusted time for finding next slot
  // If we have an offset, the "next" slot should be based on the adjusted time, not the current time
  const adjustedTime =
    adjustedTimeSeconds !== null && startOffsetSeconds !== 0
      ? formatSecondsAsTime(adjustedTimeSeconds).substring(0, 5) // Convert back to HH:MM format
      : time;

  // Use getSpeakersForTime which handles best-group selection logic
  // Apply the offset to the time for session lookup (the offset is already calculated above)
  filteredSpeakers = getSpeakersForTime({
    day,
    time: adjustedTime, // Use adjusted time instead of raw time
    location: params.location,
    startOffsetSeconds: 0, // Offset already applied to time
    endOffsetSeconds, // Still use endOffset if present (for future sessions)
  });

  console.log("[updateNameAndTitle] Finding next slot after", {
    originalTime: time,
    adjustedTime: adjustedTime,
    usingAdjusted: startOffsetSeconds !== 0,
  });

  // Build list of all session slots for navigation
  allSessionSlots = buildAllSessionSlots();
  console.log(`[updateNameAndTitle] Built ${allSessionSlots.length} session slots for navigation`);

  // Get next session speakers using getNextAgendaSlot
  const nextSlot = getNextAgendaSlot({ day, time: adjustedTime });
  nextSlotInfo = nextSlot;
  if (nextSlot) {
    console.log("[updateNameAndTitle] Fetching NEXT session speakers", {
      day: nextSlot.day,
      time: nextSlot.time,
    });

    nextSpeakers = getSpeakersForTime({
      day: nextSlot.day,
      time: nextSlot.time,
      location: params.location,
    });
  } else {
    nextSpeakers = [];
  }

  allSpeakers = getSpeakersData()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  // Auto-advance: If there's no current session but there's a next one, jump to it
  // Find the first session that starts after the adjusted time
  if (filteredSpeakers.length === 0 && allSessionSlots.length > 0 && sessionOffset === 0) {
    const adjustedSeconds = adjustedTimeSeconds ?? (time ? parseTime(time) : null);
    let targetIndex = 1; // Default to first session

    if (adjustedSeconds !== null) {
      // Find the first session starting after the adjusted time
      targetIndex = allSessionSlots.findIndex((slot) => {
        const slotSeconds = parseTime(slot.time) ?? 0;
        return slotSeconds > adjustedSeconds;
      });

      // If found, add 1 because sessionOffset is 1-indexed
      if (targetIndex >= 0) {
        targetIndex += 1;
      } else {
        // All sessions are in the past, use the last one
        targetIndex = allSessionSlots.length;
      }
    }

    console.log("[updateNameAndTitle] No current session, auto-advancing to next session", {
      adjustedTime: adjustedSeconds ? formatSecondsAsTime(adjustedSeconds) : "N/A",
      targetIndex,
      targetSlot: allSessionSlots[targetIndex - 1],
    });
    sessionOffset = targetIndex;
    navigateToSessionOffset(targetIndex);
    return; // navigateToSessionOffset will call showNameAndTitle
  }

  setViewMode(viewMode, { preserveSelection: true, announce: false, show: false });

  if (params.speaker) {
    setViewMode(ViewMode.CURRENT, { preserveSelection: false, announce: false, show: false });
    const requestedIndex = parseInt(params.speaker, 10) - 1;
    if (!Number.isNaN(requestedIndex)) {
      currentSpeakerIndex = clampIndex(requestedIndex, speakers);
    }
  } else if (params.name) {
    const lowerName = params.name.toLowerCase();
    let index = filteredSpeakers.findIndex((speaker) => speaker.name.toLowerCase().includes(lowerName));
    if (index !== -1) {
      setViewMode(ViewMode.CURRENT, { preserveSelection: false, announce: false, show: false });
      currentSpeakerIndex = clampIndex(index, filteredSpeakers);
    } else {
      index = nextSpeakers.findIndex((speaker) => speaker.name.toLowerCase().includes(lowerName));
      if (index !== -1) {
        setViewMode(ViewMode.NEXT, { preserveSelection: false, announce: false, show: false });
        currentSpeakerIndex = clampIndex(index, nextSpeakers);
      } else {
        index = allSpeakers.findIndex((speaker) => speaker.name.toLowerCase().includes(lowerName));
        if (index !== -1) {
          setViewMode(ViewMode.ALL, { preserveSelection: false, announce: false, show: false });
          currentSpeakerIndex = clampIndex(index, allSpeakers);
        }
      }
    }
  }

  synchronizeSpeakers({ preserveSelection: false });

  console.log("[updateNameAndTitle] Speaker lists:", {
    filteredSpeakers,
    nextSpeakers,
    allSpeakersCount: allSpeakers.length,
    viewMode,
    currentSpeakerIndex,
    activeSpeakers: speakers,
  });

  showNameAndTitle();
}

function showNameAndTitle() {
  const selectedSpeaker = speakers[Math.min(currentSpeakerIndex, speakers.length - 1)] || null;

  console.log("[showNameAndTitle] Displaying speaker:", {
    selectedSpeaker,
    currentSpeakerIndex,
    totalSpeakers: speakers.length,
    viewMode,
  });

  updateDebugOverlay();

  let name, title;
  if (selectedSpeaker) {
    name = selectedSpeaker.name;
    title = selectedSpeaker.title || "";
  } else {
    name = "No speaker scheduled";
    title = "";
  }

  const parser = new DOMParser();
  const svgDoc = parser.parseFromString(svgTemplate, "image/svg+xml");

  const nameTspan = svgDoc.querySelector("#Name tspan");
  const titleLine1Tspan = svgDoc.querySelector("#TitleLine1");
  const titleLine2Tspan = svgDoc.querySelector("#TitleLine2");

  nameTspan.textContent = name;

  if (title.length > 63) {
    let splitIndex = title.lastIndexOf(" ", 63);
    const preferredSplitIndexAnd = title.lastIndexOf(" and ", 63);
    const preferredSplitIndexComma = title.lastIndexOf(",", 63);
    const preferredSplitIndexAmpersand = title.lastIndexOf(" & ", 63);

    if (preferredSplitIndexAnd >= 20) {
      splitIndex = preferredSplitIndexAnd;
    } else if (preferredSplitIndexComma >= 20) {
      splitIndex = preferredSplitIndexComma;
    } else if (preferredSplitIndexAmpersand >= 20) {
      splitIndex = preferredSplitIndexAmpersand;
    }

    const titleLine1 = title.substring(0, splitIndex);
    let titleLine2 = title.substring(splitIndex + 1).trim();

    if (titleLine2.startsWith("and ")) {
      titleLine2 = titleLine2.substring(4);
    } else if (titleLine2.startsWith(",")) {
      titleLine2 = titleLine2.substring(1).trim();
    } else if (titleLine2.startsWith("& ")) {
      titleLine2 = titleLine2.substring(2);
    }

    titleLine1Tspan.textContent = titleLine1;
    titleLine2Tspan.textContent = titleLine2;
    titleLine2Tspan.classList.remove("hidden-line");
    titleLine1Tspan.setAttribute("y", "0");
    titleLine1Tspan.setAttribute("class", "t3");
  } else {
    titleLine1Tspan.textContent = title;
    titleLine2Tspan.textContent = "";
    titleLine2Tspan.classList.add("hidden-line");
    if (title.length > 30) {
      titleLine1Tspan.setAttribute("y", "35");
      titleLine1Tspan.setAttribute("class", "t3");
    } else {
      titleLine1Tspan.setAttribute("y", "40");
      titleLine1Tspan.setAttribute("class", "t3-large");
    }
  }

  const svgContainer = document.getElementById("svg-container");
  svgContainer.replaceChildren();
  svgContainer.appendChild(svgDoc.documentElement);
}

function navigateSpeakers(event) {
  // Ctrl+Space : Disable auto-update (freeze current view)
  if (event.key === " " && event.ctrlKey) {
    event.preventDefault();
    if (autoUpdateEnabled) {
      console.log("Auto-update DISABLED. Current view frozen. Press Escape to resume.");
      autoUpdateEnabled = false;
    } else {
      console.log("Auto-update already disabled. Press Escape to re-enable.");
    }
    return;
  }

  // ← → : Navigate within current speaker group
  if (event.key === "ArrowLeft") {
    if (!speakers.length) {
      return;
    }
    incrementalSearch.reset();
    currentSpeakerIndex = currentSpeakerIndex > 0 ? currentSpeakerIndex - 1 : speakers.length - 1;
    autoUpdateEnabled = false;
    setSpeakerIndex(currentSpeakerIndex, { fromUser: true });
    return;
  } else if (event.key === "ArrowRight") {
    if (!speakers.length) {
      return;
    }
    incrementalSearch.reset();
    currentSpeakerIndex = currentSpeakerIndex < speakers.length - 1 ? currentSpeakerIndex + 1 : 0;
    autoUpdateEnabled = false;
    setSpeakerIndex(currentSpeakerIndex, { fromUser: true });
    return;
  }

  // ↑ ↓ : Navigate between sessions (CURRENT <-> NEXT <-> NEXT+1...)
  else if (event.key === "ArrowUp") {
    event.preventDefault();
    incrementalSearch.reset();
    if (sessionOffset > 0) {
      navigateToSessionOffset(sessionOffset - 1);
    } else {
      console.log("Already at current session");
    }
    return;
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    incrementalSearch.reset();
    navigateToSessionOffset(sessionOffset + 1);
    return;
  }

  // Space : Toggle ALL sessions/speakers mode (removes all filters, shows everyone)
  else if (event.key === " ") {
    event.preventDefault();
    incrementalSearch.reset();
    if (viewMode === ViewMode.ALL) {
      // Go back to filtered mode with auto-update
      console.log("Returning to filtered view with auto-update.");
      setViewMode(ViewMode.CURRENT);
      autoUpdateEnabled = true;
      updateNameAndTitle();
    } else {
      // Switch to ALL speakers mode (no filters)
      console.log("Showing ALL speakers (all filters removed).");
      setViewMode(ViewMode.ALL);
      autoUpdateEnabled = false;
    }
    return;
  }

  // Escape : Return to CURRENT mode with auto-update
  else if (event.key === "Escape") {
    incrementalSearch.reset();
    console.log("Returning to current session with auto-update.");
    setViewMode(ViewMode.CURRENT);
    autoUpdateEnabled = true;
    updateNameAndTitle();
    return;
  } else if (
    handleSearchOrNumericShortcut(event, {
      onSearch: handleSearchKey,
      items: speakers,
      onBeforeSelect: incrementalSearch.reset,
      onSelect: (index) => setSpeakerIndex(index, { fromUser: true }),
    })
  ) {
    return;
  }
}

initializeEventDisplay({
  update: updateNameAndTitle,
  onKeyDown: navigateSpeakers,
  isAutoUpdateEnabled: () => autoUpdateEnabled,
}).catch((error) => console.error("Error loading event data:", error));
