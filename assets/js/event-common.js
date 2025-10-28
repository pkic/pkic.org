const DEFAULT_DATA_URL = 'event-data.json';
const DAYS_OF_WEEK = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let agendaData = {};
let speakersData = [];
let locationsData = [];
let dataPromise = null;

function formatTimeFromDate(date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function parseTime(timeString) {
    if (!timeString) {
        return null;
    }

    const parts = timeString.split(':').map(part => parseInt(part, 10));
    const hours = parts[0] || 0;
    const minutes = parts[1] || 0;
    const seconds = parts[2] || 0;
    return hours * 3600 + minutes * 60 + seconds;
}

export function formatSecondsAsTime(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function parseOffsetToSeconds(offsetValue) {
    if (offsetValue === null || offsetValue === undefined) {
        return 0;
    }

    const trimmed = `${offsetValue}`.trim();
    if (!trimmed) {
        return 0;
    }

    const match = trimmed.match(/^(-?\d+)([smh]?)$/i);
    if (!match) {
        return 0;
    }

    let value = parseInt(match[1], 10);
    if (Number.isNaN(value)) {
        return 0;
    }

    const unit = match[2].toLowerCase();
    switch (unit) {
        case 'h':
            value *= 3600;
            break;
        case 'm':
            value *= 60;
            break;
        default:
            break;
    }

    return value;
}

export function getHashParams() {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const getParam = (key) => params.get(key);

    return {
        day: getParam('day'),
        time: getParam('time'),
        location: getParam('location'),
        speaker: getParam('speaker'),
        name: getParam('name'),
        index: getParam('index'),
        textbar: getParam('textbar'),
        fullscreen: getParam('fullscreen'),
        noDescription: getParam('noDescription'),
        startOffset: getParam('startOffset'),
        endOffset: getParam('endOffset'),
        debug: getParam('debug'),
        autoSwitch: getParam('autoSwitch'),
        layout: getParam('layout'),
        clean: getParam('clean'),
        showTitle: getParam('showTitle')
    };
}

function resolveAgendaDay(paramDay) {
    if (!paramDay) {
        console.debug('[resolveAgendaDay] No day parameter provided.');
        return null;
    }

    const dayKeys = Object.keys(agendaData);
    const lowerParam = paramDay.toLowerCase();

    console.debug('[resolveAgendaDay] Resolving day', { paramDay, availableDays: dayKeys });

    if (dayKeys.length === 0) {
        console.debug('[resolveAgendaDay] No agenda data loaded, returning input as-is.');
        return paramDay;
    }

    const exactMatch = dayKeys.find((key) => key === paramDay);
    if (exactMatch) {
        console.debug('[resolveAgendaDay] Exact match found:', exactMatch);
        return exactMatch;
    }

    const caseInsensitiveMatch = dayKeys.find((key) => key.toLowerCase() === lowerParam);
    if (caseInsensitiveMatch) {
        console.debug('[resolveAgendaDay] Case-insensitive match found:', caseInsensitiveMatch);
        return caseInsensitiveMatch;
    }

    const partialMatch = dayKeys.find((key) => key.toLowerCase().includes(lowerParam));
    if (partialMatch) {
        console.debug('[resolveAgendaDay] Partial match found:', partialMatch);
        return partialMatch;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(paramDay)) {
        const parsed = new Date(`${paramDay}T00:00:00`);
        if (!Number.isNaN(parsed.getTime())) {
            const dayName = DAYS_OF_WEEK[parsed.getDay()];
            const byName = dayKeys.find((key) => key.toLowerCase().includes(dayName.toLowerCase()));
            console.debug('[resolveAgendaDay] ISO date detected', { 
                paramDay, 
                parsed: parsed.toISOString(), 
                dayName, 
                byName 
            });
            if (byName) {
                return byName;
            }
            console.debug('[resolveAgendaDay] No match found for day name, returning day name only:', dayName);
            return dayName;
        }
    }

    console.debug('[resolveAgendaDay] No resolution found, returning input as-is:', paramDay);
    return paramDay;
}

export function resolveDayTime(params, now = new Date()) {
    const { day: paramDay, time: paramTime } = params;

    let day;
    if (paramDay === 'now') {
        day = DAYS_OF_WEEK[now.getDay()];
    } else if (paramDay) {
        day = resolveAgendaDay(paramDay);
    }

    let time;
    let autoUpdate = false;
    if (paramTime === 'now') {
        time = formatTimeFromDate(now);
        autoUpdate = true;
    } else if (paramTime) {
        time = paramTime;
    }

    return { day, time, autoUpdate };
}

function getFilteredAgenda(day) {
    if (!day) {
        return agendaData;
    }

    if (agendaData[day]) {
        return { [day]: agendaData[day] };
    }

    console.debug('[getFilteredAgenda] Day not found in agenda, returning empty filter.', { day });
    return {};
}

function isWithinTimeWindow(currentSeconds, startSeconds, endSeconds, startOffsetSeconds, endOffsetSeconds) {
    if (currentSeconds === null) {
        return true;
    }

    // Apply offsets to expand the matching window around the session time:
    // - Negative startOffset moves the window start EARLIER (includes older sessions)
    // - Positive endOffset moves the window end LATER (includes future sessions)
    // Example: startOffset=-7200 means sessions starting 2 hours before can still match
    const adjustedStart = startSeconds + startOffsetSeconds;  // startOffset is negative, so this moves earlier
    const adjustedEnd = endSeconds + endOffsetSeconds;        // endOffset is positive, so this moves later
    const matches = currentSeconds >= adjustedStart && currentSeconds < adjustedEnd;
    
    if (!matches) {
        // Only log when it doesn't match to reduce noise
        return false;
    }
    
    console.debug('[isWithinTimeWindow] MATCH', {
        currentTime: formatSecondsAsTime(currentSeconds),
        slotStart: formatSecondsAsTime(startSeconds),
        slotEnd: formatSecondsAsTime(endSeconds),
        offset: startOffsetSeconds !== 0 ? `${startOffsetSeconds}s` : 'none',
        adjustedStart: formatSecondsAsTime(adjustedStart),
        adjustedEnd: formatSecondsAsTime(adjustedEnd)
    });
    
    return true;
}

export function normalizeSpeakerName(name = '') {
    return name.replace(/\s*\*+$/, '').trim();
}

export function isModerator(speakerName = '') {
    return /\s*\*+$/.test(speakerName);
}

export function findSpeakerByName(name) {
    const normalizedTarget = normalizeSpeakerName(name).toLowerCase();
    const speaker = speakersData.find(
        (speaker) => normalizeSpeakerName(speaker.name).toLowerCase() === normalizedTarget
    );
    
    if (speaker) {
        // Return a copy with isModerator flag set based on original name
        return {
            ...speaker,
            isModerator: isModerator(name)
        };
    }
    
    return null;
}

export function findSpeakerByFlexibleName(name) {
    if (!name) {
        return null;
    }

    const normalizedQuery = normalizeSpeakerName(name).toLowerCase();
    const hyphenQuery = normalizedQuery.replace(/\s+/g, '-');
    const compactQuery = normalizedQuery.replace(/\s+/g, '');

    return speakersData.find((speaker) => {
        const normalizedName = normalizeSpeakerName(speaker.name).toLowerCase();
        if (normalizedName.includes(normalizedQuery)) {
            return true;
        }

        const hyphenName = normalizedName.replace(/\s+/g, '-');
        const compactName = normalizedName.replace(/\s+/g, '');

        return hyphenName === hyphenQuery || compactName === compactQuery;
    }) || null;
}

export function getNextAgendaSlot({ day, time }) {
    const dayKeys = Object.keys(agendaData);
    if (dayKeys.length === 0) {
        return null;
    }

    let activeDay = day;
    let startIndex = 0;
    if (activeDay && dayKeys.includes(activeDay)) {
        startIndex = dayKeys.indexOf(activeDay);
    } else {
        activeDay = dayKeys[0];
    }

    let thresholdSeconds = time ? parseTime(time) : null;

    for (let dayOffset = startIndex; dayOffset < dayKeys.length; dayOffset += 1) {
        const dayKey = dayKeys[dayOffset];
        const dayAgenda = agendaData[dayKey] || [];
        const isCurrentDay = dayKey === activeDay;

        const candidates = dayAgenda
            .map((agendaSlot) => ({
                slot: agendaSlot,
                seconds: parseTime(agendaSlot.time) ?? 0
            }))
            .filter(({ seconds }) => {
                if (thresholdSeconds === null) {
                    return true;
                }

                if (isCurrentDay) {
                    return seconds > thresholdSeconds;
                }

                return true;
            })
            .sort((a, b) => a.seconds - b.seconds);

        if (candidates.length > 0) {
            return { day: dayKey, time: candidates[0].slot.time };
        }

        thresholdSeconds = null;
    }

    return null;
}

export function getSessionsForTime({ day, time, location, startOffsetSeconds = 0, endOffsetSeconds = 0 }) {
    const currentSeconds = time ? parseTime(time) : null;
    const agendaSource = getFilteredAgenda(day);
    const sessions = [];

    Object.entries(agendaSource).forEach(([dayKey, dayAgenda]) => {
        dayAgenda.forEach((agendaSlot, index) => {
            if (!agendaSlot.sessions || !Array.isArray(agendaSlot.sessions)) {
                return;
            }

            const startSeconds = parseTime(agendaSlot.time) ?? 0;
            const nextAgendaSlot = dayAgenda[index + 1];
            const endSeconds = nextAgendaSlot ? (parseTime(nextAgendaSlot.time) ?? 0) : startSeconds + 3600;
            const matchesTime = isWithinTimeWindow(currentSeconds, startSeconds, endSeconds, startOffsetSeconds, endOffsetSeconds);

            if (!matchesTime) {
                return;
            }

            agendaSlot.sessions.forEach((session) => {
                if (location) {
                    if (session.locations && session.locations.includes(location)) {
                        sessions.push(session);
                    }
                } else {
                    sessions.push(session);
                }
            });
        });
    });

    return sessions;
}

function selectBestGroup(groups, currentSeconds) {
    if (!groups.length) {
        console.debug('[selectBestGroup] No groups available.');
        return null;
    }

    if (currentSeconds === null) {
        console.debug('[selectBestGroup] No current time provided, returning first group.', {
            group: groups[0]
        });
        return groups[0];
    }

    let bestGroup = null;
    let bestScore = Number.POSITIVE_INFINITY;
    let bestProgress = -1; // Track progress into active session (for tie-breaking)

    groups.forEach((group) => {
        const { startSeconds, endSeconds } = group;
        let score;
        let progress = 0;

        if (currentSeconds >= startSeconds && currentSeconds < endSeconds) {
            score = 0;
            // Calculate how far we are into this session (0.0 to 1.0)
            const duration = endSeconds - startSeconds;
            progress = duration > 0 ? (currentSeconds - startSeconds) / duration : 0;
        } else if (currentSeconds < startSeconds) {
            score = startSeconds - currentSeconds;
        } else {
            score = (currentSeconds - endSeconds) + 1000000;
        }

        console.debug('[selectBestGroup] Evaluating group', {
            session: group.session?.title,
            startSeconds,
            endSeconds,
            score,
            progress: progress.toFixed(2),
            currentSeconds
        });

        // Prefer lower score, or if tied at score 0, prefer session we're further into
        if (score < bestScore || (score === bestScore && score === 0 && progress > bestProgress)) {
            bestScore = score;
            bestProgress = progress;
            bestGroup = group;
        }
    });

    console.debug('[selectBestGroup] Chosen group', { 
        session: bestGroup?.session?.title,
        bestScore, 
        bestProgress: bestProgress.toFixed(2)
    });
    return bestGroup;
}

export function getSpeakersForTime({ day, time, location, speakerName, startOffsetSeconds = 0, endOffsetSeconds = 0 }) {
    const currentSeconds = time ? parseTime(time) : null;
    const groups = getSessionSpeakerGroups({ day, time, location, startOffsetSeconds, endOffsetSeconds });

    console.debug('[getSpeakersForTime] Initial groups', {
        params: { day, time, location, speakerName, startOffsetSeconds, endOffsetSeconds },
        currentSeconds,
        groupCount: groups.length
    });

    if (!groups.length) {
        console.debug('[getSpeakersForTime] No sessions found - returning empty.');
        return [];
    }

    // Select the best matching session group
    const bestGroup = selectBestGroup(groups, currentSeconds);
    if (!bestGroup) {
        console.debug('[getSpeakersForTime] No best group found after selection.');
        return [];
    }

    console.debug('[getSpeakersForTime] Best group selected', { 
        session: bestGroup.session?.title,
        speakers: bestGroup.speakers.map(s => s.name)
    });

    let speakers = bestGroup.speakers || [];

    // If a specific speaker is requested, filter to that speaker only
    if (speakerName) {
        const lowerQuery = speakerName.toLowerCase();
        speakers = speakers.filter((speaker) => speaker.name.toLowerCase().includes(lowerQuery));

        console.debug('[getSpeakersForTime] Filtered to specific speaker', {
            speakerName,
            matchCount: speakers.length
        });
    }

    // Remove duplicates (shouldn't happen, but just in case)
    const unique = [];
    const seenNames = new Set();
    speakers.forEach((speaker) => {
        if (!speaker || seenNames.has(speaker.name)) {
            return;
        }
        seenNames.add(speaker.name);
        unique.push(speaker);
    });

    console.debug('[getSpeakersForTime] Final speaker list', {
        speakerCount: unique.length,
        speakers: unique.map(s => s.name)
    });

    return unique;
}

export function getSessionSpeakerGroups({ day, time, location, startOffsetSeconds = 0, endOffsetSeconds = 0 }) {
    const currentSeconds = time ? parseTime(time) : null;
    
    // STRICT: If day is specified, ONLY use that day. No fallbacks.
    const agendaSource = getFilteredAgenda(day);
    
    console.debug('[getSessionSpeakerGroups] Filtered agenda', {
        requestedDay: day,
        foundDays: Object.keys(agendaSource)
    });
    
    const groups = [];

    Object.entries(agendaSource).forEach(([dayKey, dayAgenda]) => {
        dayAgenda.forEach((agendaSlot, index) => {
            if (!agendaSlot.sessions || !Array.isArray(agendaSlot.sessions)) {
                return;
            }

            const startSeconds = parseTime(agendaSlot.time) ?? 0;
            const nextAgendaSlot = dayAgenda[index + 1];
            const endSeconds = nextAgendaSlot ? (parseTime(nextAgendaSlot.time) ?? 0) : startSeconds + 3600;
            const matchesTime = isWithinTimeWindow(currentSeconds, startSeconds, endSeconds, startOffsetSeconds, endOffsetSeconds);

            if (!matchesTime) {
                return;
            }

            agendaSlot.sessions.forEach((session) => {
                if (!session.speakers || !Array.isArray(session.speakers)) {
                    return;
                }

                if (location) {
                    if (!session.locations || !session.locations.includes(location)) {
                        return;
                    }
                }

                const speakersForSession = session.speakers
                    .map((name) => findSpeakerByName(name) || speakersData.find((s) => s.name === name))
                    .filter(Boolean);

                if (speakersForSession.length === 0) {
                    return;
                }

                groups.push({
                    day: dayKey,
                    session,
                    startSeconds,
                    endSeconds,
                    speakers: speakersForSession
                });
            });
        });
    });

    console.debug('[getSessionSpeakerGroups] Found groups', {
        groupCount: groups.length,
        sessions: groups.map(g => ({ 
            title: g.session.title, 
            start: g.startSeconds, 
            end: g.endSeconds,
            speakerCount: g.speakers.length
        }))
    });

    return groups.sort((a, b) => {
        if (a.startSeconds !== b.startSeconds) {
            return a.startSeconds - b.startSeconds;
        }
        return (a.session.title || '').localeCompare(b.session.title || '');
    });
}

export function getSessionStartTime(sessionTitle) {
    for (const dayAgenda of Object.values(agendaData)) {
        for (const agendaSlot of dayAgenda) {
            if (agendaSlot.sessions && agendaSlot.sessions.some((session) => session.title === sessionTitle)) {
                return agendaSlot.time;
            }
        }
    }
    return null;
}

export function getSpeakersData() {
    return speakersData;
}

export function loadEventData(url = DEFAULT_DATA_URL) {
    if (dataPromise) {
        return dataPromise;
    }

    dataPromise = fetch(url)
        .then((response) => response.json())
        .then((data) => {
            agendaData = data.agenda || {};
            speakersData = data.speakers || [];
            locationsData = data.locations || [];
            return { agenda: agendaData, speakers: speakersData, locations: locationsData };
        })
        .catch((error) => {
            dataPromise = null;
            throw error;
        });

    return dataPromise;
}

export function getAgendaData() {
    return agendaData;
}

export function getLocationsData() {
    return locationsData;
}
