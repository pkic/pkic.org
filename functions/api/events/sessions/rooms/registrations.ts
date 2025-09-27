
import { getEventData, getSessions, getRegistrations } from '../../../utils';

export async function onRequest({ request, env }) {
    const kv = env.KV_EVENT_REGISTRATION;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const rooms = [...new Set(allSessions.map(s => s.room))];
    const registrations = await getRegistrations(kv);
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
