
import { getEventData, getSessions, getRegistrations, getRoomAvailability, ROOM_CAPACITY } from '../../../utils';

export async function onRequest({ request, env }) {
    const kv = env.KV_EVENT_REGISTRATION;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const rooms = [...new Set(allSessions.map(s => s.room))];
    const registrations = await getRegistrations(kv);
    const { availability: roomAvailability, counts } = getRoomAvailability(registrations, allSessions, rooms);
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
