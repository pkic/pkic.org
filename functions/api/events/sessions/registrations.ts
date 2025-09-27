
import { getEventData, getSessions, getRegistrations } from '../../utils';

export async function onRequest({ request, env }) {
    const kv = env.KV_EVENT_REGISTRATION;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const registrations = await getRegistrations(kv);
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
