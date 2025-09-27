
import { getEventData, getSessions, getSessionRegistrations } from '../../utils';

export async function onRequest({ request, env }) {
    const db = env.DB;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const sessionRegistrations = {};
    const uniqueUsers = new Set();
    let totalMorningRegistrations = 0;
    let totalAfternoonRegistrations = 0;

    for (const session of allSessions) {
        const registrants = await getSessionRegistrations(db, session.title);
        sessionRegistrations[session.title] = registrants;
        registrants.forEach(userId => uniqueUsers.add(userId));

        if (session.timeSlot === 'morning') {
            totalMorningRegistrations += registrants.length;
        } else if (session.timeSlot === 'afternoon') {
            totalAfternoonRegistrations += registrants.length;
        }
    }

    const responseData = {
        sessionRegistrations,
        totalUniqueUsers: uniqueUsers.size,
        totalMorningRegistrations,
        totalAfternoonRegistrations,
    };

    return new Response(JSON.stringify(responseData), {
        headers: { 'Content-Type': 'application/json' },
    });
}
