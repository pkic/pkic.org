let sessions = [];
let currentSessionIndex = 0;
let autoUpdateEnabled = false;

let agendaData = [];
let speakersData = [];
let locationsData = [];

function getHashParams() {
    const params = new URLSearchParams(window.location.hash.substring(1));
    return {
        day: params.get('day'),
        time: params.get('time'),
        location: params.get('location')
    };
}

function parseTime(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
}

function getSessions(day, currentTime, location = null) {
    console.log("Fetching speaker details for - Day:", day, "Time:", currentTime, "Location:", location);

    const currentMinutes = currentTime ? parseTime(currentTime) : null;
    let currentSessions = [];

    const filteredAgenda = day && agendaData[day] ? { [day]: agendaData[day] } : agendaData;
    Object.values(filteredAgenda).forEach(dayAgenda => {
        dayAgenda.forEach((agendaSlot, index) => {
            const startMinutes = parseTime(agendaSlot.time);
            const nextAgendaSlot = dayAgenda[index + 1];
            const endMinutes = nextAgendaSlot ? parseTime(nextAgendaSlot.time) : startMinutes + 60;
            const timeMatches = currentMinutes !== null ? (currentMinutes >= startMinutes && currentMinutes < endMinutes) : true;

            if (timeMatches && agendaSlot.sessions) {
                if (location) {
                    agendaSlot.sessions.forEach(session => {
                        if (session.locations && session.locations.includes(location)) {
                            currentSessions.push(session);
                        }
                    });
                } else {
                    currentSessions = currentSessions.concat(agendaSlot.sessions);
                }
            }
        });
    });


    console.log("Filtered sessions:", currentSessions);
    return currentSessions;
}

function getCurrentSession(day, currentTime) {
    const currentMinutes = parseTime(currentTime);
    const dayAgenda = agendaData[day] || [];
    return dayAgenda.find((agendaSlot, index) => {
        const startMinutes = parseTime(agendaSlot.time);
        const nextAgendaSlot = dayAgenda[index + 1];
        const endMinutes = nextAgendaSlot ? parseTime(nextAgendaSlot.time) : startMinutes + 60;
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    });
}

function updateSessionAndSpeakers() {
    const selectedSession = sessions[Math.min(currentSessionIndex, sessions.length - 1)] || null;

    if (selectedSession) {
        document.getElementById('title').textContent = selectedSession.title;
        document.getElementById('description').textContent = selectedSession.description;
        document.getElementById('description').style.display = selectedSession.description ? 'block' : 'none';
        const speakersDiv = document.getElementById('speakers');
        speakersDiv.innerHTML = '';
        selectedSession.speakers.forEach(speakerName => {
            const speaker = speakersData.find(s => s.name === speakerName);
            if (speaker) {
                const speakerElement = document.createElement('div');
                speakerElement.classList.add('speaker');

                let headshot = "<span class='headshot'></span>";
                if (speaker.headshot) {
                    headshot = `<img src="${speaker.headshot.x250}"  class="headshot" />`
                }

                speakerElement.innerHTML = `
                    ${headshot}
                    <div class="name">${speaker.name}</div>
                    <div class="title">${speaker.title}</div>
                `;
                speakersDiv.appendChild(speakerElement);
            }
        });
    } else {
        document.getElementById('title').textContent = 'No session scheduled';
        document.getElementById('description').innerHTML = '';
        document.getElementById('speakers').innerHTML = '';
    }
}

function updateNameAndTitle() {
    const { day: paramDay, time: paramTime, location: paramLocation } = getHashParams();

    const now = new Date();
    let currentTime;
    if (paramTime === 'now') {
        autoUpdateEnabled = true;
        currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    } else if (paramTime) {
        currentTime = paramTime;
    }

    const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    let currentDay;
    if (paramDay === 'now') {
        currentDay = daysOfWeek[now.getDay()];
    } else if (paramDay) {
        currentDay = paramDay;
    }

    sessions = getSessions(currentDay, currentTime, paramLocation);

    updateSessionAndSpeakers();
}

function navigateSessions(event) {
    if (event.key === 'ArrowLeft') {
        currentSessionIndex = (currentSessionIndex > 0) ? currentSessionIndex - 1 : sessions.length - 1;
        autoUpdateEnabled = false;
    } else if (event.key === 'ArrowRight') {
        currentSessionIndex = (currentSessionIndex < sessions.length - 1) ? currentSessionIndex + 1 : 0;
        autoUpdateEnabled = false;
    } else if (event.key === 'ArrowUp') {
        console.log("Auto-update re-enabled. Filters (including day and time) are now active.");
        autoUpdateEnabled = true;
    } else if (/^[a-zA-Z]$/.test(event.key)) {
        const letter = event.key.toLowerCase();
        const nextSessionIndex = sessions.findIndex((session, index) =>
            index > currentSessionIndex && session.title.toLowerCase().startsWith(letter)
        );
        if (nextSessionIndex !== -1) {
            currentSessionIndex = nextSessionIndex;
        } else {
            const firstSessionIndex = sessions.findIndex(session => session.title.toLowerCase().startsWith(letter));
            if (firstSessionIndex !== -1) {
                currentSessionIndex = firstSessionIndex;
            }
        }
        autoUpdateEnabled = false;
    } else if (/^[0-9]$/.test(event.key)) {
        const index = parseInt(event.key, 10) - 1;
        if (index >= 0 && index < sessions.length) {
            currentSessionIndex = index;
        }
        autoUpdateEnabled = false;
    }

    updateSessionAndSpeakers();
}

function refreshIfAutoUpdateEnabled() {
    if (autoUpdateEnabled) {
        updateNameAndTitle();
    }
}

fetch('event-data.json')
    .then(response => response.json())
    .then(data => {

        agendaData = data.agenda || {};
        speakersData = data.speakers || [];
        locationsData = data.locations || [];

        updateNameAndTitle();
        setInterval(refreshIfAutoUpdateEnabled, 60000);

        window.addEventListener('hashchange', updateNameAndTitle);
        window.addEventListener('keydown', navigateSessions);

    })
    .catch(error => console.error('Error loading event data:', error));
