
// A simple in-memory cache for event data.
let eventDataCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const EVENT_DATA_URL = 'https://pkic.org/events/2025/pqc-conference-kuala-lumpur-my/event-data.json';
const EVENT_DATE = '2025-10-28';

// Helper function to get room capacities from environment variable.
export function getRoomCapacitiesFromEnv(env) {
  if (env.ROOM_CAPACITIES_JSON) {
    try {
      return JSON.parse(env.ROOM_CAPACITIES_JSON);
    } catch (error) {
      console.error('Error parsing ROOM_CAPACITIES_JSON environment variable:', error);
    }
  }
  return {}; // Return empty object if not set or parsing fails
}

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

// Function to get registrations for a specific session from the D1 database.
export async function getSessionRegistrations(db, sessionTitle, timeSlot) {
    const { results } = await db.prepare("SELECT user_id FROM registrations WHERE session_title = ? AND time_slot = ?").bind(sessionTitle, timeSlot).all();
    return results.map(row => row.user_id);
}

// Function to get all registrations from the D1 database.
export async function getAllRegistrations(db) {
    const { results } = await db.prepare("SELECT * FROM registrations").all();
    return results;
}

// New function to get all session registrations from the D1 database.
export async function getAllSessionRegistrations(db) {
    const { results } = await db.prepare("SELECT user_id, session_title, time_slot FROM registrations").all();
    return results;
}

// Function to update a session registration in the D1 database.
export async function updateRegistration(db, userId, sessionTitle, timeSlot, isRegistering) {
    if (isRegistering) {
        return await db.prepare("INSERT OR IGNORE INTO registrations (user_id, session_title, time_slot) VALUES (?, ?, ?)")
            .bind(userId, sessionTitle, timeSlot)
            .run();
    } else {
        return await db.prepare("DELETE FROM registrations WHERE user_id = ? AND session_title = ?")
            .bind(userId, sessionTitle)
            .run();
    }
}

// Function to check session availability.
export async function getAvailability(db, allSessions, env) {
  const roomCapacities = getRoomCapacitiesFromEnv(env);

  const { results: counts } = await db.prepare("SELECT session_title, time_slot, COUNT(*) as count FROM registrations GROUP BY session_title, time_slot").all();

  const sessionCounts = { morning: {}, afternoon: {} };
  (counts || []).forEach(row => {
    if (!sessionCounts[row.time_slot]) {
      sessionCounts[row.time_slot] = {};
    }
    sessionCounts[row.time_slot][row.session_title] = row.count;
  });

  const availability = { morning: {}, afternoon: {} };
  for (const session of allSessions) {
    if (!availability[session.timeSlot]) {
      availability[session.timeSlot] = {};
    }
    const count = sessionCounts[session.timeSlot]?.[session.title] || 0;
    const capacity = roomCapacities[session.room] || 0;
    availability[session.timeSlot][session.title] = count < capacity;
  }
  return availability;
}

// Function to check room availability.
export async function getRoomAvailability(db, allSessions, rooms, env) {
  const roomCapacities = getRoomCapacitiesFromEnv(env);

  // Fetch all registration counts grouped by session title and time slot
  const { results: sessionRegistrationCounts } = await db.prepare(
    "SELECT session_title, time_slot, COUNT(*) as count FROM registrations GROUP BY session_title, time_slot"
  ).all();

  const sessionCountsByTimeSlot = {};
  sessionRegistrationCounts.forEach(row => {
    if (!sessionCountsByTimeSlot[row.session_title]) {
      sessionCountsByTimeSlot[row.session_title] = {};
    }
    sessionCountsByTimeSlot[row.session_title][row.time_slot] = row.count;
  });

  const roomCounts = { morning: {}, afternoon: {} };
  allSessions.forEach(session => {
    const currentSessionRegistrations = sessionCountsByTimeSlot[session.title]?.[session.timeSlot] || 0;

    if (session.timeSlot === 'morning') {
      roomCounts.morning[session.room] = (roomCounts.morning[session.room] || 0) + currentSessionRegistrations;
    } else if (session.timeSlot === 'afternoon') {
      roomCounts.afternoon[session.room] = (roomCounts.afternoon[session.room] || 0) + currentSessionRegistrations;
    }
  });

  const availability = { morning: {}, afternoon: {} };
  rooms.forEach(room => {
    const capacity = roomCapacities[room] || 0;
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
