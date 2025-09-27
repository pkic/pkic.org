
// A simple in-memory cache for event data.
let eventDataCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const EVENT_DATA_URL = 'https://pkic.org/events/2025/pqc-conference-kuala-lumpur-my/event-data.json';
const EVENT_DATE = '2025-10-28';

// Hardcoded capacity for rooms.
export const ROOM_CAPACITY = {
  'room_1': 20,
  'room_2': 20,
  'room_3': 36,
  'room_4': 36,
  'room_5': 36,
  'room_6': 96,
  'room_7': 110,
  'room_8': 110,
};

// Helper function to fetch event data and cache it.
export async function getEventData() {
  const now = Date.now();
  if (eventDataCache && (now - cacheTimestamp < CACHE_TTL)) {
    return eventDataCache;
  }

  try {
    const response = await fetch(EVENT_DATA_URL);
    if (!response.ok) {
      throw new Error('Failed to fetch event data.');
    }
    eventDataCache = await response.json();
    cacheTimestamp = now;
    return eventDataCache;
  } catch (error) {
    console.error('Error fetching event data:', error);
    return null;
  }
}

// Helper function to extract sessions from the event data.
export function getSessions(eventData) {
  const sessions = [];
  // Extract speakers data for lookup
  const speakersLookup = {};
  if (eventData.speakers) {
    eventData.speakers.forEach(speaker => {
      speakersLookup[speaker.name] = speaker;
    });
  }

  if (eventData && eventData.agenda && eventData.agenda[EVENT_DATE]) {
    const agenda = eventData.agenda[EVENT_DATE];
    agenda.forEach(item => {
      let timeSlot = '';
      if (item.time) {
        const hour = parseInt(item.time.split(':')[0], 10);
        if (hour < 12) {
          timeSlot = 'morning';
        } else {
          timeSlot = 'afternoon';
        }
      }

      if (item.sessions) {
        item.sessions.forEach(session => {
          if (!session.title.startsWith('Continuation of')) {
            const room = session.locations[0];
            // Enhance speakers with headshot data
            const enhancedSpeakers = (session.speakers || []).map(speakerName => {
              const speakerData = speakersLookup[speakerName];
              return speakerData ? {
                name: speakerName,
                headshot: speakerData.headshot,
                title: speakerData.title,
                bio: speakerData.bio,
                social: speakerData.social,
                website: speakerData.website
              } : { name: speakerName };
            });
            sessions.push({ title: session.title, room, timeSlot, speakers: enhancedSpeakers, abstract: session.description || '' });
          }
        });
      }
    });
  }
  return sessions;
}

// Function to get registrations from the KV store.
export async function getRegistrations(kv) {
  const registrations = [];
  let list_complete = false;
  let cursor = undefined;
  const allKeys = [];

  while (!list_complete) {
    const page = await kv.list({ cursor });
    allKeys.push(...page.keys);
    list_complete = page.list_complete;
    cursor = page.cursor;
  }

  const values = await Promise.all(allKeys.map(key => kv.get(key.name, 'json')));

  values.forEach((value, index) => {
    if (value && value.current) {
      registrations.push({ userId: allKeys[index].name, ...value.current });
    }
  });

  return registrations;
}

// Function to check session availability.
export function getAvailability(registrations, allSessions) {
  const sessionCounts = {};
  registrations.forEach(reg => {
    if (reg.morningSession) {
      sessionCounts[reg.morningSession] = (sessionCounts[reg.morningSession] || 0) + 1;
    }
    if (reg.afternoonSession) {
      sessionCounts[reg.afternoonSession] = (sessionCounts[reg.afternoonSession] || 0) + 1;
    }
  });
  const availability = {};
  allSessions.forEach(session => {
    const count = sessionCounts[session.title] || 0;
    const capacity = ROOM_CAPACITY[session.room] || 0;
    availability[session.title] = count < capacity;
  });
  return availability;
}

// Function to check room availability.
export function getRoomAvailability(registrations, allSessions, rooms) {
  const sessionCounts = {};
  registrations.forEach(reg => {
    if (reg.morningSession) {
      sessionCounts[reg.morningSession] = (sessionCounts[reg.morningSession] || 0) + 1;
    }
    if (reg.afternoonSession) {
      sessionCounts[reg.afternoonSession] = (sessionCounts[reg.afternoonSession] || 0) + 1;
    }
  });
  const roomCounts = { morning: {}, afternoon: {} };
  allSessions.forEach(session => {
    const count = sessionCounts[session.title] || 0;
    if (session.timeSlot === 'morning') {
      roomCounts.morning[session.room] = (roomCounts.morning[session.room] || 0) + count;
    } else if (session.timeSlot === 'afternoon') {
      roomCounts.afternoon[session.room] = (roomCounts.afternoon[session.room] || 0) + count;
    }
  });
  const availability = { morning: {}, afternoon: {} };
  rooms.forEach(room => {
    const capacity = ROOM_CAPACITY[room] || 0;
    availability.morning[room] = (roomCounts.morning[room] || 0) < capacity;
    availability.afternoon[room] = (roomCounts.afternoon[room] || 0) < capacity;
  });
  return { availability, counts: roomCounts };
}

// New helper function to verify a signed user ID.
export async function verifySignedUserId(signedUserId, secretKey) {
  if (!secretKey || secretKey.length === 0) {
    return false;
  }
  const parts = signedUserId.split('.');
  if (parts.length !== 2) {
    return false;
  }

  const userId = parts[0];
  const signature = parts[1];

  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(userId));
    const signatureHex = Array.from(new Uint8Array(signatureBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    return signatureHex === signature;
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}
