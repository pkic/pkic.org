import { loadEventData, getHashParams, getSpeakersData, findSpeakerByFlexibleName } from "./event-common.js";

const conferenceTitle = document.body.dataset.conferenceTitle ?? document.title;
let speakersData = [];
let currentSpeakerIndex = 0;

function showSpeakerCard() {
  const { name, speaker, index } = getHashParams();

  let selectedSpeaker = null;

  // Ensure we have speakers data
  if (!speakersData || speakersData.length === 0) {
    console.warn("No speakers data available");
    document.body.classList.remove("speaker-card-mode");
    return;
  }

  if (name) {
    // Find speaker by name
    selectedSpeaker = findSpeakerByFlexibleName(name);
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

  if (!name && !speaker && !index) selectedSpeaker = speakersData[0];

  if (selectedSpeaker) {
    // Show speaker card mode
    document.body.classList.add("speaker-card-mode");

    currentSpeakerIndex = speakersData.indexOf(selectedSpeaker);

    // Update speaker information
    const speakerNameEl = document.getElementById("speaker-name");
    const speakerTitleEl = document.getElementById("speaker-title");
    const speakerPhotoEl = document.getElementById("speaker-photo");

    if (speakerNameEl) speakerNameEl.textContent = selectedSpeaker.name || "Speaker Name";
    if (speakerTitleEl) speakerTitleEl.textContent = selectedSpeaker.title || "";

    // Set speaker photo
    if (speakerPhotoEl) {
      if (selectedSpeaker.headshot && selectedSpeaker.headshot.x250) {
        const image = document.createElement("img");
        image.src = selectedSpeaker.headshot.x250;
        image.alt = selectedSpeaker.name;
        speakerPhotoEl.replaceChildren(image);
      } else {
        // Create initials placeholder
        const names = (selectedSpeaker.name || "Speaker").split(" ");
        const initials = names
          .map((name) => name.charAt(0))
          .join("")
          .substring(0, 2)
          .toUpperCase();
        const placeholder = document.createElement("div");
        placeholder.className = "speaker-photo-placeholder";
        placeholder.textContent = initials;
        speakerPhotoEl.replaceChildren(placeholder);
      }
    }

    // Update page title for better SEO and sharing
    document.title = `${selectedSpeaker.name} - Speaker at ${conferenceTitle}`;

    // Add meta tags for social sharing
    updateMetaTags(selectedSpeaker);

    console.log("Showing speaker card for:", selectedSpeaker.name);
  } else {
    currentSpeakerIndex = 0;
    // Show regular session view
    document.body.classList.remove("speaker-card-mode");
    console.log("No speaker found for hash parameters:", { name, speaker, index });
  }
}

function updateMetaTags(speaker) {
  // Update or create meta tags for better social media sharing
  const metaTags = {
    "og:title": `${speaker.name} - Speaker at ${conferenceTitle}`,
    "og:description": speaker.title || `${conferenceTitle}`,
    "og:image": speaker.headshot ? speaker.headshot.x600 || speaker.headshot.x250 : "",
    "twitter:card": "summary_large_image",
    "twitter:title": `${speaker.name} - Speaker at ${conferenceTitle}`,
    "twitter:description": speaker.title || `Speaker at ${conferenceTitle}`,
  };

  Object.entries(metaTags).forEach(([property, content]) => {
    if (content) {
      let metaTag = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
      if (!metaTag) {
        metaTag = document.createElement("meta");
        if (property.startsWith("og:")) {
          metaTag.setAttribute("property", property);
        } else {
          metaTag.setAttribute("name", property);
        }
        document.head.appendChild(metaTag);
      }
      metaTag.setAttribute("content", content);
    }
  });
}

function navigateSpeakers(event) {
  if (!speakersData || speakersData.length === 0) {
    return;
  }

  let newIndex = currentSpeakerIndex;

  if (event.key === "ArrowLeft") {
    newIndex = currentSpeakerIndex > 0 ? currentSpeakerIndex - 1 : speakersData.length - 1;
  } else if (event.key === "ArrowRight") {
    newIndex = currentSpeakerIndex < speakersData.length - 1 ? currentSpeakerIndex + 1 : 0;
  } else if (/^[0-9]$/.test(event.key)) {
    const num = parseInt(event.key);
    if (num > 0 && num <= speakersData.length) {
      newIndex = num - 1;
    }
  }

  if (newIndex !== currentSpeakerIndex && newIndex >= 0 && newIndex < speakersData.length) {
    // Update the URL hash to show the new speaker
    window.location.hash = `speaker=${newIndex + 1}`;
  }
}

// Load event data and initialize
loadEventData(document.body.dataset.conferenceData)
  .then(() => {
    speakersData = getSpeakersData();

    // Initial display
    showSpeakerCard();

    // Listen for hash changes
    window.addEventListener("hashchange", showSpeakerCard);

    // Listen for keyboard navigation
    window.addEventListener("keydown", navigateSpeakers);
  })
  .catch((error) => {
    console.error("Error loading event data:", error);
    speakersData = getSpeakersData();
    // Fallback: still show the card interface even without data
    showSpeakerCard();
  });

// Export function for external use
window.showSpeakerCard = showSpeakerCard;
