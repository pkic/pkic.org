
import { getEventData, getSessions, getAvailability } from '../../utils';

export async function onRequest({ request, env }) {
    const db = env.DB;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const availability = await getAvailability(db, allSessions, env);
    const sessionsWithAvailability = allSessions.map(s => ({
        ...s,
        available: availability[s.title]
    }));
    return new Response(JSON.stringify(sessionsWithAvailability), {
        headers: { 'Content-Type': 'application/json' },
    });
}
