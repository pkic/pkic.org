
import { getEventData, getSessions, getSessionRegistrations } from '../../utils';

export async function onRequest({ request, env }) {
    const db = env.DB;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const rooms = [...new Set(allSessions.map(s => s.room))];
    const roomRegistrations = {};
    rooms.forEach(room => {
        roomRegistrations[room] = { morning: [], afternoon: [] };
    });

    for (const session of allSessions) {
        const registrants = await getSessionRegistrations(db, session.title);
        if (session.timeSlot === 'morning') {
            roomRegistrations[session.room].morning.push(...registrants);
        } else if (session.timeSlot === 'afternoon') {
            roomRegistrations[session.room].afternoon.push(...registrants);
        }
    }

    return new Response(JSON.stringify(roomRegistrations), {
        headers: { 'Content-Type': 'application/json' },
    });
}
