
import { getEventData, getSessions, getRegistrations, getAvailability, verifySignedUserId } from '../../../utils';

export async function onRequest({ request, env, params }) {
    const url = new URL(request.url);
    const kv = env.KV_EVENT_REGISTRATION;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }
    const allSessions = getSessions(eventData);

    const signatureParam = url.searchParams.get('signature');
    const catchall = params.catchall;

    if (catchall.length === 1 && catchall[0] === 'registrations') {
        const registrations = await getRegistrations(kv);
        const allUsers = registrations.map(reg => ({
            userId: reg.userId,
            morningSession: reg.morningSession,
            afternoonSession: reg.afternoonSession
        }));
        return new Response(JSON.stringify(allUsers), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (catchall.length === 1) {
        const id = catchall[0];
        if (!id) return new Response('Not Found', { status: 404 });

        // Validate signature
        if (!signatureParam) {
            return new Response('Forbidden: Signature required.', { status: 403 });
        }
        const signedUserId = id + '.' + signatureParam;
        if (!(await verifySignedUserId(signedUserId, env.SECRET_KEY))) {
            return new Response('Forbidden: Invalid signature.', { status: 403 });
        }

        const userRegData = await kv.get(id, 'json');
        const data = userRegData ? userRegData.current : null;
        return new Response(JSON.stringify(data), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (catchall.length === 2 && catchall[1] === 'update' && request.method === 'POST') {
        const id = catchall[0];
        if (!id) return new Response('Not Found', { status: 404 });

        // Validate signature
        if (!signatureParam) {
            return new Response('Forbidden: Signature required.', { status: 403 });
        }
        const signedUserId = id + '.' + signatureParam;
        if (!(await verifySignedUserId(signedUserId, env.SECRET_KEY))) {
            return new Response('Forbidden: Invalid signature.', { status: 403 });
        }

        const { morningSession, afternoonSession } = await request.json();

        // Get current data before checking availability
        const currentData = await kv.get(id, 'json') || { current: { morningSession: '', afternoonSession: '' }, changes: [] };
        const oldRegistration = currentData.current;

        // Re-fetch registrations to get the latest state for availability check
        const registrations = await getRegistrations(kv);
        const availability = getAvailability(registrations, allSessions);

        // Check for overbooking, allowing the user to re-save their existing full session.
        if (morningSession && !availability[morningSession] && morningSession !== oldRegistration.morningSession) {
            return new Response(JSON.stringify({ success: false, message: `It looks like "${morningSession}" just filled up. Please select a different morning session.` }), {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (afternoonSession && !availability[afternoonSession] && afternoonSession !== oldRegistration.afternoonSession) {
            return new Response(JSON.stringify({ success: false, message: `It looks like "${afternoonSession}" just filled up. Please select a different afternoon session.` }), {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Add to changes
        currentData.changes.push({
            timestamp: Date.now(),
            action: 'update',
            oldMorning: oldRegistration.morningSession,
            oldAfternoon: oldRegistration.afternoonSession,
            newMorning: morningSession,
            newAfternoon: afternoonSession
        });
        currentData.current = { morningSession, afternoonSession };

        await kv.put(id, JSON.stringify(currentData));
        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response('Not Found', { status: 404 });
}
