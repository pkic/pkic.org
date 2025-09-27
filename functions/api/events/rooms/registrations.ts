
import { getEventData, getSessions, getAllSessionRegistrations } from '../../utils';

export async function onRequest({ request, env }) {
    const db = env.DB;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }

    const allSessions = getSessions(eventData);
    const roomRegistrations = {
        morning: {}, // Change to object
        afternoon: {} // Change to object
    };

    // Initialize roomRegistrations with room names and empty attendee lists
    allSessions.forEach(session => {
        if (session.timeSlot === 'morning') {
            roomRegistrations.morning[session.room] = roomRegistrations.morning[session.room] || [];
        } else if (session.timeSlot === 'afternoon') {
            roomRegistrations.afternoon[session.room] = roomRegistrations.afternoon[session.room] || [];
        }
    });

    // Fetch all registrations once
    const allRegistrations = await getAllSessionRegistrations(db);

    // Process all registrations to populate roomRegistrations
    allRegistrations.forEach(registration => {
        // Find the corresponding session to get its room
        const session = allSessions.find(s => s.title === registration.session_title && s.timeSlot === registration.time_slot);
        if (session) {
            const targetTimeSlot = roomRegistrations[registration.time_slot];
            if (targetTimeSlot) {
                const targetRoomAttendees = targetTimeSlot[session.room];
                if (targetRoomAttendees) {
                    targetRoomAttendees.push(registration.user_id);
                } else {
                    console.warn(`Registration found for unknown room within ${registration.time_slot}: ${session.room}`);
                }
            } else {
                console.warn(`Registration found for unknown timeSlot: ${registration.time_slot}`);
            }
        } else {
            console.warn(`Registration found for unknown session: ${registration.session_title} (${registration.time_slot})`);
        }
    });

    return new Response(JSON.stringify(roomRegistrations), {
        headers: { 'Content-Type': 'application/json' },
    });
}
