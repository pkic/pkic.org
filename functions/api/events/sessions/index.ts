
import { getEventData, getSessions, getRegistrations, getAvailability } from '../../utils';

export async function onRequest({ request, env }) {
    const kv = env.KV_EVENT_REGISTRATION;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const registrations = await getRegistrations(kv);
    const availability = getAvailability(registrations, allSessions);
    const sessionsWithAvailability = allSessions.map(s => ({
        ...s,
        available: availability[s.title]
    }));
    return new Response(JSON.stringify(sessionsWithAvailability), {
        headers: { 'Content-Type': 'application/json' },
    });
}
