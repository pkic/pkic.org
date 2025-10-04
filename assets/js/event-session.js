import {
    loadEventData,
    getHashParams,
    resolveDayTime,
    parseOffsetToSeconds,
    getSessionsForTime,
    getSessionStartTime,
    parseTime,
    findSpeakerByName,
    getNextAgendaSlot
} from './event-common.js';

let sessions = [];
let currentSessionIndex = 0;
let autoUpdateEnabled = false;
let autoSwitchEnabled = false;

let countdownInterval = null;
let searchBuffer = '';
let searchResetTimer = null;

const SEARCH_RESET_DELAY = 1000;

function createHeadshotWithBadge(speaker) {
    const wrapper = document.createElement('div');
    wrapper.className = 'headshot-wrapper';
    
    if (speaker.headshot) {
        const headshotImg = document.createElement('img');
        headshotImg.src = speaker.headshot.x250;
        headshotImg.className = 'headshot';
        headshotImg.alt = speaker.name;
        wrapper.appendChild(headshotImg);
    } else {
        const headshotSpan = document.createElement('span');
        headshotSpan.className = 'headshot';
        wrapper.appendChild(headshotSpan);
    }
    
    if (speaker.isModerator) {
        const badge = document.createElement('div');
        badge.className = 'moderator-badge';
        badge.textContent = 'MODERATOR';
        wrapper.appendChild(badge);
    }
    
    return wrapper;
}

function updateSessionAndSpeakers() {
    const selectedSession = sessions[Math.min(currentSessionIndex, sessions.length - 1)] || null;
    const params = getHashParams();
    const layout = params.layout || 'default'; // default, panel, vertical
    const isCleanMode = params.clean === 'true' || params.clean === '1';
    const showTitle = params.showTitle === 'true' || params.showTitle === '1';

    if (selectedSession) {
        const titleElement = document.getElementById('title');
        const descriptionElement = document.getElementById('description');
        const subjectElement = document.getElementById('subject');
        
        // In clean mode, only show title if showTitle parameter is set
        if (isCleanMode && showTitle) {
            titleElement.textContent = selectedSession.title;
            titleElement.style.display = 'block';
            descriptionElement.style.display = 'none';
            subjectElement.classList.add('show-title');
        } else if (isCleanMode) {
            titleElement.style.display = 'none';
            descriptionElement.style.display = 'none';
            subjectElement.classList.remove('show-title');
        } else {
            titleElement.textContent = selectedSession.title;
            titleElement.style.display = 'block';
            descriptionElement.textContent = selectedSession.description;
            descriptionElement.style.display = selectedSession.description ? 'block' : 'none';
            subjectElement.classList.remove('show-title');
        }
        
        const speakersList = document.getElementById('speakersList');
        speakersList.innerHTML = '';
        
        // Set layout class
        speakersList.className = `layout-${layout}`;

        if (layout === 'panel') {
            // Panel layout: Create headshots row with names/titles below each headshot
            const headshotsRow = document.createElement('div');
            headshotsRow.className = 'headshots-row';

            selectedSession.speakers.forEach(speakerName => {
                const speaker = findSpeakerByName(speakerName);
                if (speaker) {
                    // Both clean and normal mode: Headshot with name/title directly below
                    const headshotContainer = document.createElement('div');
                    headshotContainer.className = 'headshot-container';
                    
                    headshotContainer.appendChild(createHeadshotWithBadge(speaker));
                    
                    const speakerInfo = document.createElement('div');
                    speakerInfo.className = 'speaker-info';
                    speakerInfo.innerHTML = `
                        <div class="name">${speaker.name}</div>
                        <div class="title">${speaker.title}</div>
                    `;
                    headshotContainer.appendChild(speakerInfo);
                    headshotsRow.appendChild(headshotContainer);
                }
            });

            speakersList.appendChild(headshotsRow);

        } else if (layout === 'vertical') {
            // Vertical layout: Stack speakers with headshot on left
            selectedSession.speakers.forEach(speakerName => {
                const speaker = findSpeakerByName(speakerName);
                if (speaker) {
                    const speakerElement = document.createElement('div');
                    speakerElement.classList.add('speaker');

                    speakerElement.appendChild(createHeadshotWithBadge(speaker));

                    const speakerInfo = document.createElement('div');
                    speakerInfo.className = 'speaker-info';
                    speakerInfo.innerHTML = `
                        <div class="name">${speaker.name}</div>
                        <div class="title">${speaker.title}</div>
                    `;
                    speakerElement.appendChild(speakerInfo);
                    speakersList.appendChild(speakerElement);
                }
            });

        } else {
            // Default/Grid layout: Original behavior
            selectedSession.speakers.forEach(speakerName => {
                const speaker = findSpeakerByName(speakerName);
                if (speaker) {
                    const speakerElement = document.createElement('div');
                    speakerElement.classList.add('speaker');

                    speakerElement.appendChild(createHeadshotWithBadge(speaker));

                    const speakerInfo = document.createElement('div');
                    speakerInfo.className = 'speaker-info';
                    speakerInfo.innerHTML = `
                        <div class="name">${speaker.name}</div>
                        <div class="title">${speaker.title}</div>
                    `;
                    speakerElement.appendChild(speakerInfo);

                    speakersList.appendChild(speakerElement);
                }
            });
        }

        // Update textbar countdown if needed
        const { textbar: paramTextbar, noDescription } = params;
        if (paramTextbar === 'start') {
            updateTextbarCountdown(selectedSession.title);
            if (countdownInterval) {
                clearInterval(countdownInterval);
            }
            countdownInterval = setInterval(() => updateTextbarCountdown(selectedSession.title), 60000);
        }

        // Hide description if noDescription param is set
        if (noDescription === 'true') {
            document.getElementById('description').style.display = 'none';
        }
    } else {
        document.getElementById('title').textContent = 'No session scheduled';
        document.getElementById('description').innerHTML = '';
        document.getElementById('speakers').innerHTML = '';
    }
}

function setFullscreenMode(enable) {
    document.body.style.padding = enable ? '0' : getComputedStyle(document.documentElement).getPropertyValue('--padding');
    const sessionDiv = document.getElementById('session');
    if (sessionDiv) {
        document.querySelectorAll('body > div').forEach(div => {
            if (div !== sessionDiv) {
                div.style.display = enable ? 'none' : '';
            }
        });
        sessionDiv.className = enable ? 'fullscreen' : 'centered';
    }
}

function updateTextbarCountdown(sessionTitle) {
    const startTime = getSessionStartTime(sessionTitle);
    if (!startTime) {
        document.getElementById('textbar').textContent = 'Session not found';
        return;
    }

    const now = new Date();
    const startSeconds = parseTime(startTime);
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const secondsLeft = startSeconds - currentSeconds;

    const textbar = document.getElementById('textbar');
    if (secondsLeft > 0) {
        const hours = Math.floor(secondsLeft / 3600);
        const minutes = Math.floor((secondsLeft % 3600) / 60);
        if (hours > 0) {
            textbar.textContent = `Starting in ${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}...`;
        } else {
            textbar.textContent = `Starting in ${minutes} minute${minutes !== 1 ? 's' : ''}...`;
        }
    } else if (secondsLeft > -120) {
        textbar.textContent = 'Starting soon...';
    } else {
        textbar.textContent = 'pkic.org/ask';
    }
}

function updateNameAndTitle() {
    const params = getHashParams();
    const { textbar: paramTextbar, fullscreen: paramFullscreen, noDescription, autoSwitch, clean } = params;

    // Enable auto-switching if parameter is set
    autoSwitchEnabled = (autoSwitch === 'true' || autoSwitch === '1');

    // Apply clean mode (hide header, footer, title, background)
    if (clean === 'true' || clean === '1') {
        document.body.classList.add('clean-mode');
    } else {
        document.body.classList.remove('clean-mode');
    }

    // Clear existing interval if any
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    // Set textbar text if provided
    if (paramTextbar && paramTextbar !== 'start') {
        document.getElementById('textbar').textContent = paramTextbar;
    }

    // Trigger fullscreen mode if specified
    if (paramFullscreen === 'true') {
        setFullscreenMode(true);
    }

    // Hide description if noDescription param is set
    if (noDescription === 'true') {
        document.getElementById('description').style.display = 'none';
    }

    const { day, time, autoUpdate } = resolveDayTime(params);
    
    // Only enable auto-update if time=now
    if (autoUpdate) {
        autoUpdateEnabled = true;
    }

    const startOffsetSeconds = parseOffsetToSeconds(params.startOffset);
    const endOffsetSeconds = parseOffsetToSeconds(params.endOffset);

    sessions = getSessionsForTime({
        day,
        time,
        location: params.location,
        startOffsetSeconds,
        endOffsetSeconds
    });

    console.log("Filtered sessions:", sessions);

    // Auto-switch to next session if enabled and no current session
    if (autoSwitchEnabled && sessions.length === 0 && autoUpdateEnabled) {
        const nextSlot = getNextAgendaSlot({ day, time });
        if (nextSlot) {
            console.log("Auto-switching to next session:", nextSlot);
            const nextSessions = getSessionsForTime({
                day: nextSlot.day,
                time: nextSlot.time,
                location: params.location,
                startOffsetSeconds,
                endOffsetSeconds
            });
            if (nextSessions.length > 0) {
                sessions = nextSessions;
                currentSessionIndex = 0;
            }
        }
    }

    updateSessionAndSpeakers();
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

function findSessionIndexInList(list, query) {
    if (!list || !list.length) {
        return -1;
    }

    const lowerQuery = query.toLowerCase();
    
    // First pass: search from current position forward for startsWith match
    let index = list.findIndex((session, idx) => 
        idx > currentSessionIndex && 
        session.title && 
        session.title.toLowerCase().startsWith(lowerQuery)
    );
    if (index !== -1) {
        return index;
    }
    
    // Second pass: search from beginning for startsWith match
    index = list.findIndex((session) => 
        session.title && 
        session.title.toLowerCase().startsWith(lowerQuery)
    );
    if (index !== -1) {
        return index;
    }
    
    // Third pass: search for contains match
    index = list.findIndex((session, idx) => 
        idx > currentSessionIndex && 
        session.title && 
        session.title.toLowerCase().includes(lowerQuery)
    );
    if (index !== -1) {
        return index;
    }
    
    // Fourth pass: search from beginning for contains match
    index = list.findIndex((session) => 
        session.title && 
        session.title.toLowerCase().includes(lowerQuery)
    );
    
    return index;
}

function handleSearchKey(key) {
    const character = key.toLowerCase();
    searchBuffer += character;
    scheduleSearchReset();

    // Search within the current session list
    const foundIndex = findSessionIndexInList(sessions, searchBuffer);
    if (foundIndex !== -1) {
        currentSessionIndex = foundIndex;
        autoUpdateEnabled = false;
        updateSessionAndSpeakers();
        return;
    }

    console.log(`No session match for "${searchBuffer}"`);
}

function navigateSessions(event) {
    if (event.ctrlKey || event.altKey) {
        return;
    }

    // ← → : Navigate within current session list
    if (event.key === 'ArrowLeft') {
        if (!sessions.length) {
            return;
        }
        resetSearchBuffer();
        currentSessionIndex = (currentSessionIndex > 0) ? currentSessionIndex - 1 : sessions.length - 1;
        autoUpdateEnabled = false;
        updateSessionAndSpeakers();
        return;
    } else if (event.key === 'ArrowRight') {
        if (!sessions.length) {
            return;
        }
        resetSearchBuffer();
        currentSessionIndex = (currentSessionIndex < sessions.length - 1) ? currentSessionIndex + 1 : 0;
        autoUpdateEnabled = false;
        updateSessionAndSpeakers();
        return;
    }
    
    // Space : Toggle auto-update mode (re-enable time/day filters)
    else if (event.key === ' ') {
        event.preventDefault();
        resetSearchBuffer();
        if (autoUpdateEnabled) {
            console.log("Auto-update disabled. Freezing current view.");
            autoUpdateEnabled = false;
        } else {
            console.log("Auto-update re-enabled. Filters (including day and time) are now active.");
            autoUpdateEnabled = true;
            updateNameAndTitle();
        }
        return;
    }
    
    // Escape : Return to current session with auto-update
    else if (event.key === 'Escape') {
        resetSearchBuffer();
        console.log("Returning to current session with auto-update.");
        autoUpdateEnabled = true;
        updateNameAndTitle();
        return;
    }
    
    // a-z : Incremental search for sessions
    else if (/^[a-zA-Z]$/.test(event.key)) {
        handleSearchKey(event.key);
        return;
    }
    
    // 0-9 : Jump to session by index
    else if (/^[0-9]$/.test(event.key)) {
        resetSearchBuffer();
        const numericValue = parseInt(event.key, 10);
        let index = numericValue - 1;
        if (numericValue === 0) {
            index = 9;
        }
        if (sessions.length && index >= 0 && index < sessions.length) {
            currentSessionIndex = index;
            autoUpdateEnabled = false;
            updateSessionAndSpeakers();
        }
        return;
    }
    
    // +/- : Toggle fullscreen mode
    else if (event.key === '+') {
        resetSearchBuffer();
        setFullscreenMode(true);
        return;
    } else if (event.key === '-') {
        resetSearchBuffer();
        setFullscreenMode(false);
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
        window.addEventListener('keydown', navigateSessions);
    })
    .catch(error => console.error('Error loading event data:', error));
