
import { getEventData, getSessions, getAllSessionRegistrations } from '../../utils';

export async function onRequest({ request, env }) {
    const db = env.DB;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const sessionRegistrations = {
        morning: {}, // Change to object
        afternoon: {} // Change to object
    };
    const uniqueUsers = new Set();
    let totalMorningRegistrations = 0;
    let totalAfternoonRegistrations = 0;

    // Initialize sessionRegistrations with session titles and empty attendee lists
    allSessions.forEach(session => {
        if (session.timeSlot === 'morning') {
            sessionRegistrations.morning[session.title] = []; // Assign empty array directly
        } else if (session.timeSlot === 'afternoon') {
            sessionRegistrations.afternoon[session.title] = []; // Assign empty array directly
        }
    });

    // Fetch all registrations once
    const allRegistrations = await getAllSessionRegistrations(db);

    // Process all registrations
    allRegistrations.forEach(registration => {
        uniqueUsers.add(registration.user_id);

        // Find the corresponding session in the initialized structure
        const targetTimeSlot = sessionRegistrations[registration.time_slot];
        if (targetTimeSlot) {
            const targetSessionAttendees = targetTimeSlot[registration.session_title];
            if (targetSessionAttendees) { // Check if session title exists
                targetSessionAttendees.push(registration.user_id);
                if (registration.time_slot === 'morning') {
                    totalMorningRegistrations++;
                } else if (registration.time_slot === 'afternoon') {
                    totalAfternoonRegistrations++;
                }
            } else {
                console.warn(`Registration found for unknown session title within ${registration.time_slot}: ${registration.session_title}`);
            }
        } else {
            console.warn(`Registration found for unknown timeSlot: ${registration.time_slot}`);
        }
    });

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
