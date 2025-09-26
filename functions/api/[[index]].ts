// This Cloudflare Pages function handles all requests for the /register path
// and serves a self-contained web component and its backend API.

// A simple in-memory cache for event data.
let eventDataCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const EVENT_DATA_URL = 'https://pkic.org/events/2025/pqc-conference-kuala-lumpur-my/event-data.json';
const EVENT_DATE = '2025-10-28';

// Hardcoded capacity for rooms.
const ROOM_CAPACITY = {
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
async function getEventData() {
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
function getSessions(eventData) {
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
      if (item.time && item.time.startsWith('9')) timeSlot = 'morning';
      if (item.time && item.time.startsWith('14')) timeSlot = 'afternoon';

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
async function getRegistrations(kv) {
  const registrations = [];
  let list_complete = false;
  let cursor = undefined;
  while (!list_complete) {
    const page = await kv.list({ cursor });
    for (const key of page.keys) {
      const value = await kv.get(key.name, 'json');
      if (value && value.current) {
        registrations.push({ userId: key.name, ...value.current });
      }
    }
    list_complete = page.list_complete;
    cursor = page.cursor;
  }
  return registrations;
}

// Function to check session availability.
function getAvailability(registrations, allSessions) {
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
function getRoomAvailability(registrations, allSessions, rooms) {
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
async function verifySignedUserId(signedUserId, secretKey) {
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


export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const kv = env.KV_EVENT_REGISTRATION; // Binding for the KV store.

  // The path name is now relative to the function's URL.
  const path = url.pathname.toLowerCase();

  if (path.startsWith('/api/')) {
    const eventData = await getEventData();
    if (!eventData) {
      return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const rooms = [...new Set(allSessions.map(s => s.room))];
    const registrations = await getRegistrations(kv);
    const availability = getAvailability(registrations, allSessions);
    const { availability: roomAvailability, counts } = getRoomAvailability(registrations, allSessions, rooms);

    // Validate the user ID for user-specific API calls.
    const signatureParam = url.searchParams.get('signature');

    if (path === '/api/events/sessions') {
      const sessionsWithAvailability = allSessions.map(s => ({
        ...s,
        available: availability[s.title]
      }));
      return new Response(JSON.stringify(sessionsWithAvailability), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/events/sessions/registrations') {
      const sessionRegistrations = {};
      allSessions.forEach(session => {
        sessionRegistrations[session.title] = [];
      });
      registrations.forEach(reg => {
        if (reg.morningSession) {
          sessionRegistrations[reg.morningSession].push(reg.userId);
        }
        if (reg.afternoonSession) {
          sessionRegistrations[reg.afternoonSession].push(reg.userId);
        }
      });
      return new Response(JSON.stringify(sessionRegistrations), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/events/sessions/rooms') {
      const roomsData = rooms.map(room => {
        const capacity = ROOM_CAPACITY[room] || 0;
        const morningCount = counts.morning[room] || 0;
        const afternoonCount = counts.afternoon[room] || 0;
        const percentageMorning = capacity > 0 ? Math.round((morningCount / capacity) * 100) : 0;
        const percentageAfternoon = capacity > 0 ? Math.round((afternoonCount / capacity) * 100) : 0;
        return {
          room,
          capacity,
          morningCount,
          afternoonCount,
          percentageMorning,
          percentageAfternoon,
          availableMorning: roomAvailability.morning[room],
          availableAfternoon: roomAvailability.afternoon[room]
        };
      });
      return new Response(JSON.stringify(roomsData), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path === '/api/events/sessions/rooms/registrations') {
      const roomRegistrations = {};
      rooms.forEach(room => {
        roomRegistrations[room] = { morning: [], afternoon: [] };
      });
      registrations.forEach(reg => {
        if (reg.morningSession) {
          const session = allSessions.find(s => s.title === reg.morningSession && s.timeSlot === 'morning');
          if (session) {
            roomRegistrations[session.room].morning.push(reg.userId);
          }
        }
        if (reg.afternoonSession) {
          const session = allSessions.find(s => s.title === reg.afternoonSession && s.timeSlot === 'afternoon');
          if (session) {
            roomRegistrations[session.room].afternoon.push(reg.userId);
          }
        }
      });
      return new Response(JSON.stringify(roomRegistrations), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (path.startsWith('/api/events/sessions/users/')) {
      const parts = path.split('/api/events/sessions/users/');
      if (parts.length < 2) return new Response('Not Found', { status: 404 });
      const subpath = parts[1];

      if (subpath === 'registrations') {
        const allUsers = registrations.map(reg => ({
          userId: reg.userId,
          morningSession: reg.morningSession,
          afternoonSession: reg.afternoonSession
        }));
        return new Response(JSON.stringify(allUsers), {
          headers: { 'Content-Type': 'application/json' },
        });
      } else {
        const id = subpath.split('/')[0];
        if (!id) return new Response('Not Found', { status: 404 });

        // Validate signature
        if (!signatureParam) {
          return new Response('Forbidden: Signature required.', { status: 403 });
        }
        const signedUserId = id + '.' + signatureParam;
        if (!(await verifySignedUserId(signedUserId, env.SECRET_KEY))) {
          return new Response('Forbidden: Invalid signature.', { status: 403 });
        }
        const userId = id;

        if (path === `/api/events/sessions/users/${id}`) {
          const userReg = registrations.find(r => r.userId === id);
          const data = userReg ? { morningSession: userReg.morningSession, afternoonSession: userReg.afternoonSession } : null;
          return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (request.method === 'POST' && path === `/api/events/sessions/users/${id}/update`) {
          const { morningSession, afternoonSession } = await request.json();

          // Check for overbooking.
          if (morningSession && !availability[morningSession]) {
            return new Response(JSON.stringify({ success: false, message: 'Morning session is full.' }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (afternoonSession && !availability[afternoonSession]) {
            return new Response(JSON.stringify({ success: false, message: 'Afternoon session is full.' }), {
              status: 409,
              headers: { 'Content-Type': 'application/json' },
            });
          }

          // Get current data
          const currentData = await kv.get(id, 'json') || { current: { morningSession: '', afternoonSession: '' }, changes: [] };
          const old = currentData.current;

          // Add to changes
          currentData.changes.push({
            timestamp: Date.now(),
            action: 'update',
            oldMorning: old.morningSession,
            oldAfternoon: old.afternoonSession,
            newMorning: morningSession,
            newAfternoon: afternoonSession
          });
          currentData.current = { morningSession, afternoonSession };

          await kv.put(id, JSON.stringify(currentData));
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }

    // Return 404 for unknown API endpoints
    return new Response('Not Found', { status: 404 });

  } else {
    // Return a 404 for any other path.
    return new Response('Not Found', { status: 404 });
  }
}
