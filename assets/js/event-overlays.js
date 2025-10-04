import {
    loadEventData,
    getHashParams,
    resolveDayTime,
    parseOffsetToSeconds,
    getSpeakersForTime,
    getNextAgendaSlot,
    getSpeakersData,
    getSessionSpeakerGroups,
    parseTime,
    formatSecondsAsTime,
    getAgendaData
} from './event-common.js';

const svgTemplate = `
<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2500 417" width="100%">
    <title>Lower Third Title</title>
    <style>
         tspan { white-space:pre } 
         .s0 { opacity: .8;fill: #ffffff } 
         .s1 { fill: #ffffff } 
         .t2 { font-size: 95px;fill: #000000; font-weight: 900;font-family: "Roboto-Black", "Roboto", "Helvetica" } 
         .t3 { font-size: 60px;fill: #434343; font-weight: 500;font-family: "Roboto-Medium", "Roboto", "Helvetica" } 
         .t3-large { font-size: 85px;fill: #434343; font-weight: 500;font-family: "Roboto-Medium", "Roboto", "Helvetica" } 
         .s4 { fill: #5a9bd5 } 
         .s5 { fill: #ed7d31 } 
         .s6 { fill: #188754 }
    </style>
    <path id="Title BG" class="s0" d="m2484 233v184h-1929v-184z"/>
    <path id="Name BG" class="s1" d="m2331 6v228h-1949.5l-19.9-138.3-109.6-89.7z"/>
    <text id="Name" style="transform: matrix(1,0,0,1,482,160)">
         <tspan x="0" y="0" class="t2">Fullname</tspan>
    </text>
    <text id="Title" style="transform: matrix(1,0,0,1,625,310)">
         <tspan id="TitleLine1" x="0" y="0" class="t3">Title Line 1</tspan>
         <tspan id="TitleLine2" x="0" y="80" class="t3">Title Line 2</tspan>
    </text>
    <g id="Element">
         <path id="Bottom" class="s4" d="m238.9 372.4c-10.8 18.7-12.9 44.5-37.1 44.5-24.1 0-26.2-25.8-37-44.5-36.1-7.2-68.5-24.8-93.9-49.6l18.5-17.5c29.2 28 68.8 45.2 112.4 45.2 43.7 0 83.3-17.2 112.4-45.2l18.6 17.5c-25.4 24.8-57.8 42.4-93.9 49.6z"/>
         <path id="Right" class="s5" d="m252.9 7.1c31.3 8.8 59.3 25.6 81.7 48q4.2 4.2 8.1 8.7c21.6 0 45.1-11.1 57.2 9.8 12 20.9-9.3 35.7-20.1 54.4 6.4 18.8 9.8 39 9.8 60 0 16-2 31.4-5.7 46.2l-24.4-7.3c3-12.4 4.7-25.5 4.7-38.9 0-44.8-18.2-85.5-47.6-114.9-19.1-19.1-42.9-33.4-69.6-41.2z"/>
         <path id="Left" class="s6" d="m23.6 128.6c-10.8-18.7-32.1-33.5-20-54.4 12.1-20.9 35.5-9.8 57.1-9.8q3.9-4.5 8.1-8.7c22.4-22.4 50.4-39.1 81.7-48l5.9 24.8c-26.7 7.8-50.5 22.1-69.6 41.3-29.3 29.4-47.5 70-47.5 114.9 0 13.4 1.6 26.4 4.7 38.8l-24.5 7.3c-3.7-14.7-5.7-30.2-5.7-46.1 0-21 3.5-41.2 9.8-60.1z"/>
         <path id="Table" fill-rule="evenodd" class="s1" d="m292.1 97.7c23.1 23.1 37.4 55 37.4 90.3 0 18.8-4 36.6-11.3 52.7l52.6 30.4-12.6 22-52.7-30.5c-4 5.7-8.5 10.9-13.4 15.8-23.1 23.2-55 37.5-90.3 37.5-35.2 0-67.1-14.3-90.2-37.5-4.9-4.9-9.4-10.1-13.4-15.8l-52.7 30.5-12.6-22 52.6-30.4c-7.3-16.1-11.3-33.9-11.3-52.7 0-35.3 14.3-67.2 37.4-90.3 20.3-20.3 47.3-33.9 77.5-36.8v-60.8h25.5v60.8c30.1 2.9 57.2 16.5 77.5 36.8zm-18 18c-18.5-18.5-44-30-72.3-30-28.2 0-53.7 11.5-72.2 30-18.5 18.5-30 44.1-30 72.3 0 28.3 11.5 53.9 30 72.4 18.5 18.5 44 30 72.2 30 28.3 0 53.8-11.5 72.3-30 18.5-18.5 30-44.1 30-72.4 0-28.2-11.5-53.8-30-72.3z"/>
         <path id="Keyhole" class="s1" d="m187.7 182.5l-17.6 68.4h63.5l-17.6-68.4c9.6-5.1 16.2-15.2 16.2-26.9 0-16.8-13.6-30.4-30.4-30.4-16.7 0-30.3 13.6-30.3 30.4 0 11.7 6.6 21.8 16.2 26.9z"/>
    </g>
</svg>
`;

const ViewMode = {
    CURRENT: 'current',     // Current session speakers
    NEXT: 'next',          // Next session speakers  
    ALL: 'all'             // All speakers (no filters)
};

const SEARCH_RESET_DELAY = 1000;

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

let searchBuffer = '';
let searchResetTimer = null;
let debugOverlay = null;

function createDebugOverlay() {
    if (debugOverlay) {
        return;
    }
    
    debugOverlay = document.createElement('div');
    debugOverlay.id = 'debug-overlay';
    debugOverlay.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.92);
        color: #0f0;
        font-family: 'Courier New', monospace;
        font-size: 13px;
        padding: 20px;
        border-radius: 8px;
        border: 2px solid #0f0;
        z-index: 10000;
        max-width: 600px;
        line-height: 1.5;
        box-shadow: 0 0 20px rgba(0, 255, 0, 0.3);
    `;
    document.body.appendChild(debugOverlay);
}

function updateDebugOverlay() {
    const params = getHashParams();
    if (!params.debug || params.debug === '0' || params.debug === 'false') {
        if (debugOverlay) {
            debugOverlay.remove();
            debugOverlay = null;
        }
        return;
    }
    
    createDebugOverlay();
    
    const { day, time } = resolveDayTime(params);
    const startOffsetSeconds = parseOffsetToSeconds(params.startOffset);
    const currentTimeSeconds = time ? parseTime(time) : null;
    const adjustedTimeSeconds = currentTimeSeconds !== null ? currentTimeSeconds + startOffsetSeconds : null;
    
    const currentSlot = sessionOffset === 0 && allSessionSlots.length > 0 ? allSessionSlots[0] : null;
    const activeSlot = sessionOffset > 0 && sessionOffset <= allSessionSlots.length ? allSessionSlots[sessionOffset - 1] : currentSlot;
    
    const prevSlot = sessionOffset > 0 && allSessionSlots[sessionOffset - 2] ? allSessionSlots[sessionOffset - 2] : null;
    const nextSlot = sessionOffset < allSessionSlots.length && allSessionSlots[sessionOffset] ? allSessionSlots[sessionOffset] : null;
    
    // Get session titles
    const getSessionTitle = (slot) => {
        if (!slot) return null;
        const groups = getSessionSpeakerGroups({ 
            day: slot.day, 
            time: slot.time,
            location: params.location
        });
        return groups.length > 0 ? groups[0].session?.title : null;
    };
    
    const prevSessionTitle = getSessionTitle(prevSlot);
    const currentSessionTitle = getSessionTitle(activeSlot);
    const nextSessionTitle = getSessionTitle(nextSlot);
    
    // Build speaker shortcuts list (0-9)
    let speakerShortcuts = '';
    if (speakers.length > 0) {
        const shortcutCount = Math.min(10, speakers.length);
        for (let i = 0; i < shortcutCount; i++) {
            const shortcutKey = (i + 1) % 10; // 1-9, then 0 for index 9
            const speaker = speakers[i];
            const isActive = i === currentSpeakerIndex ? ' style="color: #ff0; font-weight: bold;"' : '';
            speakerShortcuts += `<div${isActive}>[${shortcutKey}] ${speaker.name}</div>`;
        }
    } else {
        speakerShortcuts = '<div style="color: #888;">No speakers available</div>';
    }
    
    debugOverlay.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 10px; color: #ff0; text-align: center; font-size: 16px;">🔧 DEBUG OVERLAY</div>
        <div><strong>View Mode:</strong> ${viewMode.toUpperCase()}</div>
        <div><strong>Session Offset:</strong> ${sessionOffset} of ${allSessionSlots.length}</div>
        <div><strong>Speakers:</strong> ${speakers.length} (showing: ${currentSpeakerIndex + 1}/${speakers.length})</div>
        <hr style="border-color: #444; margin: 10px 0;">
        <div><strong>Current Time:</strong> ${time || 'N/A'}</div>
        <div><strong>Start Offset:</strong> ${params.startOffset || '0'} (${startOffsetSeconds}s)</div>
        <div><strong>Adjusted Time:</strong> ${adjustedTimeSeconds !== null ? formatSecondsAsTime(adjustedTimeSeconds).substring(0, 5) : 'N/A'}</div>
        <hr style="border-color: #444; margin: 10px 0;">
        <div style="color: #f80;"><strong>◀ PREV SESSION:</strong></div>
        <div style="color: #f80; margin-left: 20px;">${prevSlot ? `${prevSlot.day} ${prevSlot.time}` : 'None'}</div>
        ${prevSessionTitle ? `<div style="color: #f80; margin-left: 20px; font-style: italic;">"${prevSessionTitle}"</div>` : ''}
        
        <div style="color: #0f0; margin-top: 8px;"><strong>● CURRENT SESSION:</strong></div>
        <div style="color: #0f0; margin-left: 20px;">${activeSlot ? `${activeSlot.day} ${activeSlot.time}` : 'None'}</div>
        ${currentSessionTitle ? `<div style="color: #0f0; margin-left: 20px; font-style: italic;">"${currentSessionTitle}"</div>` : ''}
        
        <div style="color: #08f; margin-top: 8px;"><strong>▶ NEXT SESSION:</strong></div>
        <div style="color: #08f; margin-left: 20px;">${nextSlot ? `${nextSlot.day} ${nextSlot.time}` : 'None'}</div>
        ${nextSessionTitle ? `<div style="color: #08f; margin-left: 20px; font-style: italic;">"${nextSessionTitle}"</div>` : ''}
        <hr style="border-color: #444; margin: 10px 0;">
        <div style="margin-bottom: 5px;"><strong>Speaker Shortcuts (0-9):</strong></div>
        <div style="margin-left: 10px; font-size: 12px;">
            ${speakerShortcuts}
        </div>
        <hr style="border-color: #444; margin: 10px 0;">
        <div style="font-size: 11px; color: #888; text-align: center;">
            ←→ Navigate speakers | ↑↓ Navigate sessions<br>
            0-9 Jump to speaker | a-z Search<br>
            Space: All mode | Ctrl+Space: Freeze | Esc: Reset
        </div>
    `;
}

function resetSearchBuffer() {
    searchBuffer = '';
    if (searchResetTimer) {
        clearTimeout(searchResetTimer);
        searchResetTimer = null;
    }
}

function scheduleSearchReset() {
    if (searchResetTimer) {
        clearTimeout(searchResetTimer);
    }
    searchResetTimer = setTimeout(() => {
        searchBuffer = '';
        searchResetTimer = null;
    }, SEARCH_RESET_DELAY);
}

function buildAllSessionSlots(startDay, startTime) {
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
                    time: agendaSlot.time
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
            location: params.location
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
    let message = `View mode: ${viewMode.toUpperCase()} (${count} speaker${count === 1 ? '' : 's'})`;
    
    if (viewMode === ViewMode.CURRENT && filteredSpeakers.length > 0) {
        const params = getHashParams();
        const { day, time } = resolveDayTime(params);
        const groups = getSessionSpeakerGroups({ 
            day, 
            time, 
            location: params.location,
            startOffsetSeconds: parseOffsetToSeconds(params.startOffset),
            endOffsetSeconds: parseOffsetToSeconds(params.endOffset)
        });
        if (groups.length > 0) {
            const currentSeconds = time ? parseTime(time) : null;
            const bestGroup = groups[0]; // selectBestGroup would pick this
            message += ` – Session: "${bestGroup.session?.title}" at ${day} ${time}`;
        }
    } else if (viewMode === ViewMode.NEXT && nextSlotInfo) {
        const dayText = nextSlotInfo.day ? `${nextSlotInfo.day} ` : '';
        const groups = getSessionSpeakerGroups({ 
            day: nextSlotInfo.day, 
            time: nextSlotInfo.time
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
    const passes = [
        (name) => name.startsWith(lowerQuery),
        (name) => name.includes(lowerQuery)
    ];

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
    searchBuffer += character;
    scheduleSearchReset();

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

    console.log('[updateNameAndTitle] Fetching CURRENT session speakers', {
        day,
        time,
        currentTimeSeconds,
        startOffset: params.startOffset,
        startOffsetSeconds,
        adjustedTimeSeconds,
        adjustedTimeFormatted: adjustedTimeSeconds !== null ? formatSecondsAsTime(adjustedTimeSeconds) : 'N/A',
        endOffsetSeconds
    });

    // Use getSpeakersForTime which handles best-group selection logic
    filteredSpeakers = getSpeakersForTime({
        day,
        time,
        location: params.location,
        startOffsetSeconds,
        endOffsetSeconds
    });

    // Calculate adjusted time for finding next slot
    // If we have an offset, the "next" slot should be based on the adjusted time, not the current time
    const adjustedTime = (adjustedTimeSeconds !== null && startOffsetSeconds !== 0) 
        ? formatSecondsAsTime(adjustedTimeSeconds).substring(0, 5) // Convert back to HH:MM format
        : time;

    console.log('[updateNameAndTitle] Finding next slot after', {
        originalTime: time,
        adjustedTime: adjustedTime,
        usingAdjusted: startOffsetSeconds !== 0
    });

    // Build list of all session slots for navigation
    allSessionSlots = buildAllSessionSlots(day, adjustedTime);
    console.log(`[updateNameAndTitle] Built ${allSessionSlots.length} session slots for navigation`);

    // Get next session speakers using getNextAgendaSlot
    const nextSlot = getNextAgendaSlot({ day, time: adjustedTime });
    nextSlotInfo = nextSlot;
    if (nextSlot) {
        console.log('[updateNameAndTitle] Fetching NEXT session speakers', {
            day: nextSlot.day,
            time: nextSlot.time
        });
        
        nextSpeakers = getSpeakersForTime({
            day: nextSlot.day,
            time: nextSlot.time,
            location: params.location
        });
    } else {
        nextSpeakers = [];
    }

    allSpeakers = getSpeakersData().slice().sort((a, b) => a.name.localeCompare(b.name));

    // Auto-advance: If there's no current session but there's a next one, jump to it
    if (filteredSpeakers.length === 0 && allSessionSlots.length > 0 && sessionOffset === 0) {
        console.log('[updateNameAndTitle] No current session, auto-advancing to next session');
        sessionOffset = 1;
        navigateToSessionOffset(1);
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

    console.log('[updateNameAndTitle] Speaker lists:', {
        filteredSpeakers,
        nextSpeakers,
        allSpeakersCount: allSpeakers.length,
        viewMode,
        currentSpeakerIndex,
        activeSpeakers: speakers
    });
    
    showNameAndTitle();
}

function showNameAndTitle() {
    const selectedSpeaker = speakers[Math.min(currentSpeakerIndex, speakers.length - 1)] || null;

    console.log('[showNameAndTitle] Displaying speaker:', {
        selectedSpeaker,
        currentSpeakerIndex,
        totalSpeakers: speakers.length,
        viewMode
    });

    updateDebugOverlay();

    let name, title;
    if (selectedSpeaker) {
        name = selectedSpeaker.name;
        title = selectedSpeaker.title;
    } else {
        name = "No speaker scheduled";
        title = "";
    }

    const parser = new DOMParser();
    const svgDoc = parser.parseFromString(svgTemplate, 'image/svg+xml');

    const nameTspan = svgDoc.querySelector('#Name tspan');
    const titleLine1Tspan = svgDoc.querySelector('#TitleLine1');
    const titleLine2Tspan = svgDoc.querySelector('#TitleLine2');

    nameTspan.textContent = name;

    if (title.length > 63) {
        let splitIndex = title.lastIndexOf(' ', 63);
        const preferredSplitIndexAnd = title.lastIndexOf(' and ', 63);
        const preferredSplitIndexComma = title.lastIndexOf(',', 63);
        const preferredSplitIndexAmpersand = title.lastIndexOf(' & ', 63);

        if (preferredSplitIndexAnd >= 20) {
            splitIndex = preferredSplitIndexAnd;
        } else if (preferredSplitIndexComma >= 20) {
            splitIndex = preferredSplitIndexComma;
        } else if (preferredSplitIndexAmpersand >= 20) {
            splitIndex = preferredSplitIndexAmpersand;
        }

        const titleLine1 = title.substring(0, splitIndex);
        let titleLine2 = title.substring(splitIndex + 1).trim();

        if (titleLine2.startsWith('and ')) {
            titleLine2 = titleLine2.substring(4);
        } else if (titleLine2.startsWith(',')) {
            titleLine2 = titleLine2.substring(1).trim();
        } else if (titleLine2.startsWith('& ')) {
            titleLine2 = titleLine2.substring(2);
        }

        titleLine1Tspan.textContent = titleLine1;
        titleLine2Tspan.textContent = titleLine2;
        titleLine2Tspan.style.display = 'inline';
        titleLine1Tspan.setAttribute('y', '0');
        titleLine1Tspan.setAttribute('class', 't3');
    } else {
        titleLine1Tspan.textContent = title;
        titleLine2Tspan.textContent = '';
        titleLine2Tspan.style.display = 'none';
        if (title.length > 30) {
            titleLine1Tspan.setAttribute('y', '35');
            titleLine1Tspan.setAttribute('class', 't3');
        } else {
            titleLine1Tspan.setAttribute('y', '40');
            titleLine1Tspan.setAttribute('class', 't3-large');
        }
    }

    const svgContainer = document.getElementById('svg-container');
    svgContainer.innerHTML = '';
    svgContainer.appendChild(svgDoc.documentElement);
}

function navigateSpeakers(event) {
    // Ctrl+Space : Disable auto-update (freeze current view)
    if (event.key === ' ' && event.ctrlKey) {
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
    if (event.key === 'ArrowLeft') {
        if (!speakers.length) {
            return;
        }
        resetSearchBuffer();
        currentSpeakerIndex = (currentSpeakerIndex > 0) ? currentSpeakerIndex - 1 : speakers.length - 1;
        autoUpdateEnabled = false;
        setSpeakerIndex(currentSpeakerIndex, { fromUser: true });
        return;
    } else if (event.key === 'ArrowRight') {
        if (!speakers.length) {
            return;
        }
        resetSearchBuffer();
        currentSpeakerIndex = (currentSpeakerIndex < speakers.length - 1) ? currentSpeakerIndex + 1 : 0;
        autoUpdateEnabled = false;
        setSpeakerIndex(currentSpeakerIndex, { fromUser: true });
        return;
    }
    
    // ↑ ↓ : Navigate between sessions (CURRENT <-> NEXT <-> NEXT+1...)
    else if (event.key === 'ArrowUp') {
        event.preventDefault();
        resetSearchBuffer();
        if (sessionOffset > 0) {
            navigateToSessionOffset(sessionOffset - 1);
        } else {
            console.log('Already at current session');
        }
        return;
    } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        resetSearchBuffer();
        navigateToSessionOffset(sessionOffset + 1);
        return;
    }
    
    // Space : Toggle ALL sessions/speakers mode (removes all filters, shows everyone)
    else if (event.key === ' ') {
        event.preventDefault();
        resetSearchBuffer();
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
    else if (event.key === 'Escape') {
        resetSearchBuffer();
        console.log("Returning to current session with auto-update.");
        setViewMode(ViewMode.CURRENT);
        autoUpdateEnabled = true;
        updateNameAndTitle();
        return;
    }
    
    // a-z : Incremental search within current group
    else if (/^[a-zA-Z]$/.test(event.key)) {
        handleSearchKey(event.key);
        return;
    }
    
    // 0-9 : Jump to speaker by index within current group
    else if (/^[0-9]$/.test(event.key)) {
        resetSearchBuffer();
        const numericValue = parseInt(event.key, 10);
        let index = numericValue - 1;
        if (numericValue === 0) {
            index = 9;
        }
        if (speakers.length && index >= 0 && index < speakers.length) {
            setSpeakerIndex(index, { fromUser: true });
        }
        return;
    }
}

function refreshIfAutoUpdateEnabled() {
    if (autoUpdateEnabled) {
        updateNameAndTitle();
    }
}

loadEventData()
    .then(() => {
        updateNameAndTitle();
        setInterval(refreshIfAutoUpdateEnabled, 60000);

        window.addEventListener('hashchange', updateNameAndTitle);
        window.addEventListener('keydown', navigateSpeakers);
    })
    .catch(error => console.error('Error loading event data:', error));
