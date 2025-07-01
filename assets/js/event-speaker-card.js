let speakers = [];
let currentSpeakerIndex = 0;

let agendaData = [];
let speakersData = [];
let locationsData = [];

function getHashParams() {
    const params = new URLSearchParams(window.location.hash.substring(1));
    return {
        name: params.get('name'),
        speaker: params.get('speaker'),
        index: params.get('index')
    };
}

function getAllSpeakers() {
    // Return all speakers from the data
    return speakersData || [];
}

function findSpeakerByName(name) {
    if (!name) return null;
    
    return speakersData.find(speaker => 
        speaker.name.toLowerCase().includes(name.toLowerCase()) ||
        speaker.name.toLowerCase().replace(/\s+/g, '-') === name.toLowerCase() ||
        speaker.name.toLowerCase().replace(/\s+/g, '') === name.toLowerCase()
    );
}

function showSpeakerCard() {
    const { name, speaker, index } = getHashParams();
    
    let selectedSpeaker = null;
    
    // Ensure we have speakers data
    if (!speakersData || speakersData.length === 0) {
        console.warn('No speakers data available');
        document.body.classList.remove('speaker-card-mode');
        return;
    }
    
    if (name) {
        // Find speaker by name
        selectedSpeaker = findSpeakerByName(name);
    } else if (speaker) {
        // Find speaker by 1-based index
        const speakerIndex = parseInt(speaker) - 1;
        if (speakerIndex >= 0 && speakerIndex < speakersData.length) {
            selectedSpeaker = speakersData[speakerIndex];
        }
    } else if (index) {
        // Find speaker by 0-based index
        const speakerIndex = parseInt(index);
        if (speakerIndex >= 0 && speakerIndex < speakersData.length) {
            selectedSpeaker = speakersData[speakerIndex];
        }
    }
    
    if (selectedSpeaker) {
        // Show speaker card mode
        document.body.classList.add('speaker-card-mode');
        
        // Update speaker information
        const speakerNameEl = document.getElementById('speaker-name');
        const speakerTitleEl = document.getElementById('speaker-title');
        const speakerPhotoEl = document.getElementById('speaker-photo');
        
        if (speakerNameEl) speakerNameEl.textContent = selectedSpeaker.name || 'Speaker Name';
        if (speakerTitleEl) speakerTitleEl.textContent = selectedSpeaker.title || '';
        
        // Set speaker photo
        if (speakerPhotoEl) {
            if (selectedSpeaker.headshot && selectedSpeaker.headshot.x250) {
                speakerPhotoEl.innerHTML = `<img src="${selectedSpeaker.headshot.x250}" alt="${selectedSpeaker.name}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            } else {
                // Create initials placeholder
                const names = (selectedSpeaker.name || 'Speaker').split(' ');
                const initials = names.map(name => name.charAt(0)).join('').substring(0, 2).toUpperCase();
                speakerPhotoEl.innerHTML = `<div class="speaker-photo-placeholder">${initials}</div>`;
            }
        }
        
        // Update page title for better SEO and sharing
        document.title = `${selectedSpeaker.name} - Speaker at Post-Quantum Cryptography Conference 2025`;
        
        // Add meta tags for social sharing
        updateMetaTags(selectedSpeaker);
        
        console.log('Showing speaker card for:', selectedSpeaker.name);
    } else {
        // Show regular session view
        document.body.classList.remove('speaker-card-mode');
        console.log('No speaker found for hash parameters:', { name, speaker, index });
    }
}

function updateMetaTags(speaker) {
    // Update or create meta tags for better social media sharing
    const metaTags = {
        'og:title': `${speaker.name} - Speaker at Post-Quantum Cryptography Conference 2025`,
        'og:description': speaker.title || 'Speaker at Post-Quantum Cryptography Conference 2025, October 28-30, 2025, Kuala Lumpur, Malaysia',
        'og:image': speaker.headshot ? speaker.headshot.x600 || speaker.headshot.x250 : '',
        'twitter:card': 'summary_large_image',
        'twitter:title': `${speaker.name} - Speaker at Post-Quantum Cryptography Conference 2025`,
        'twitter:description': speaker.title || 'Speaker at Post-Quantum Cryptography Conference 2025'
    };
    
    Object.entries(metaTags).forEach(([property, content]) => {
        if (content) {
            let metaTag = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
            if (!metaTag) {
                metaTag = document.createElement('meta');
                if (property.startsWith('og:')) {
                    metaTag.setAttribute('property', property);
                } else {
                    metaTag.setAttribute('name', property);
                }
                document.head.appendChild(metaTag);
            }
            metaTag.setAttribute('content', content);
        }
    });
}

function navigateSpeakers(event) {
    const { name, speaker, index } = getHashParams();
    const currentIndex = name ? speakersData.findIndex(s => s.name.toLowerCase().includes(name.toLowerCase())) :
                        speaker ? parseInt(speaker) - 1 :
                        index ? parseInt(index) : 0;
    
    let newIndex = currentIndex;
    
    if (event.key === 'ArrowLeft') {
        newIndex = currentIndex > 0 ? currentIndex - 1 : speakersData.length - 1;
    } else if (event.key === 'ArrowRight') {
        newIndex = currentIndex < speakersData.length - 1 ? currentIndex + 1 : 0;
    } else if (/^[0-9]$/.test(event.key)) {
        const num = parseInt(event.key);
        if (num > 0 && num <= speakersData.length) {
            newIndex = num - 1;
        }
    }
    
    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < speakersData.length) {
        // Update the URL hash to show the new speaker
        window.location.hash = `speaker=${newIndex + 1}`;
    }
}

// Load event data and initialize
fetch('event-data.json')
    .then(response => response.json())
    .then(data => {
        agendaData = data.agenda || {};
        speakersData = data.speakers || [];
        locationsData = data.locations || [];
        
        // Initial display
        showSpeakerCard();
        
        // Listen for hash changes
        window.addEventListener('hashchange', showSpeakerCard);
        
        // Listen for keyboard navigation
        window.addEventListener('keydown', navigateSpeakers);
    })
    .catch(error => {
        console.error('Error loading event data:', error);
        // Fallback: still show the card interface even without data
        showSpeakerCard();
    });

// Export function for external use
window.showSpeakerCard = showSpeakerCard;
