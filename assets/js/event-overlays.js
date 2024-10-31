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

let speakers = [];
let currentSpeakerIndex = 0;
let autoUpdateEnabled = false;

let agendaData = [];
let speakersData = [];
let locationsData = [];

function getHashParams() {
    const params = new URLSearchParams(window.location.hash.substring(1));
    return {
        day: params.get('day'),
        time: params.get('time'),
        location: params.get('location'),
        speaker: params.get('speaker'),
        name: params.get('name')
    };
}

function parseTime(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return hours * 60 + minutes;
}

function getSpeakers(day, currentTime, location = null, speakerName = null) {
    console.log("Fetching speaker details for - Day:", day, "Time:", currentTime, "Location:", location, "Speaker Name:", speakerName);

    const currentMinutes = currentTime ? parseTime(currentTime) : null;
    let currentSpeakers = [];

    const filteredAgenda = day && agendaData[day] ? { [day]: agendaData[day] } : agendaData;
    Object.values(filteredAgenda).forEach(dayAgenda => {
        dayAgenda.forEach((agendaSlot, index) => {
            const startMinutes = parseTime(agendaSlot.time);
            const nextAgendaSlot = dayAgenda[index + 1];
            const endMinutes = nextAgendaSlot ? parseTime(nextAgendaSlot.time) : startMinutes + 60;
            const timeMatches = currentMinutes !== null ? (currentMinutes >= startMinutes && currentMinutes < endMinutes) : true;

            if (timeMatches && agendaSlot.sessions) {
                agendaSlot.sessions.forEach(session => {
                    if (location) {
                        if (session.locations && session.locations.includes(location)) {
                            session.speakers.forEach(speakerName => {
                                const speaker = speakersData.find(s => s.name === speakerName);
                                if (speaker) currentSpeakers.push(speaker);
                            });
                        }
                    } else {
                        session.speakers.forEach(speakerName => {
                            const speaker = speakersData.find(s => s.name === speakerName);
                            if (speaker) currentSpeakers.push(speaker);
                        });
                    }
                });
            }
        });
    });

    if (speakerName) {
        currentSpeakers = currentSpeakers.filter(speaker => speaker.name.toLowerCase().includes(speakerName.toLowerCase()));
        currentSpeakers.sort((a, b) => a.name.localeCompare(b.name));
    }

    console.log("Filtered speakers:", currentSpeakers);
    return currentSpeakers;
}

function updateNameAndTitle() {
    const { day: paramDay, time: paramTime, speaker: paramSpeaker, name: paramName, location: paramLocation } = getHashParams();

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

    speakers = getSpeakers(currentDay, currentTime, paramLocation, paramName);
    if (paramSpeaker) {
        currentSpeakerIndex = parseInt(paramSpeaker) - 1;
    }

    showNameAndTitle();
}

function showNameAndTitle() {
    const selectedSpeaker = speakers[Math.min(currentSpeakerIndex, speakers.length - 1)] || null;

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
    if (event.key === 'ArrowLeft') {
        currentSpeakerIndex = (currentSpeakerIndex > 0) ? currentSpeakerIndex - 1 : speakers.length - 1;
        autoUpdateEnabled = false;
    } else if (event.key === 'ArrowRight') {
        currentSpeakerIndex = (currentSpeakerIndex < speakers.length - 1) ? currentSpeakerIndex + 1 : 0;
        autoUpdateEnabled = false;
    } else if (event.key === 'ArrowUp') {
        console.log("Auto-update re-enabled. Filters (including day and time) are now active.");
        autoUpdateEnabled = true;
    } else if (/^[a-zA-Z]$/.test(event.key)) {
        const letter = event.key.toLowerCase();
        const nextSpeakerIndex = speakers.findIndex((speaker, index) =>
            index > currentSpeakerIndex && speaker.name.toLowerCase().startsWith(letter)
        );
        if (nextSpeakerIndex !== -1) {
            currentSpeakerIndex = nextSpeakerIndex;
        } else {
            const firstSpeakerIndex = speakers.findIndex(speaker => speaker.name.toLowerCase().startsWith(letter));
            if (firstSpeakerIndex !== -1) {
                currentSpeakerIndex = firstSpeakerIndex;
            }
        }
        autoUpdateEnabled = false;
    } else if (/^[0-9]$/.test(event.key)) {
        const index = parseInt(event.key, 10) - 1;
        if (index >= 0 && index < speakers.length) {
            currentSpeakerIndex = index;
        }
        autoUpdateEnabled = false;
    }
    showNameAndTitle();
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
        window.addEventListener('keydown', navigateSpeakers);

    })
    .catch(error => console.error('Error loading event data:', error));
