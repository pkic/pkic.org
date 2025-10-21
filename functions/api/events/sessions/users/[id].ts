
import { getEventData, getSessions, getAvailability, verifySignedUserId } from '../../../utils';

export async function onRequest({ request, env, params }) {
    const url = new URL(request.url);
    const signatureParam = url.searchParams.get('signature');
    const id = params.id as string;

    // Validate signature (extracted to run once)
    if (!signatureParam) {
        return new Response('Forbidden: Signature required.', { status: 403 });
    }
    const signedUserId = id + '.' + signatureParam;
    if (!(await verifySignedUserId(signedUserId, env.SECRET_KEY))) {
        return new Response('Forbidden: Invalid signature.', { status: 403 });
    }

    const db = env.DB;
    const eventData = await getEventData();
    if (!eventData) {
        return new Response('Event data not available.', { status: 500 });
    }
    const allSessions = getSessions(eventData);

    if (request.method === 'GET') {
        const { results } = await db.prepare("SELECT * FROM registrations WHERE user_id = ?").bind(id).all();
        const data = results.reduce((acc, row) => {
            if (row.time_slot === 'morning') {
                acc.morningSession = row.session_title;
            } else if (row.time_slot === 'afternoon') {
                acc.afternoonSession = row.session_title;
            }
            return acc;
        }, { morningSession: null, afternoonSession: null });

        return new Response(JSON.stringify(data), {
            headers: { 
                'Content-Type': 'application/json',
                'Cache-Control': 'max-age=15',
            },
        });
    }

    if (request.method === 'POST') {
        const { morningSession, afternoonSession } = await request.json();

        // Get current registration
        const { results } = await db.prepare("SELECT * FROM registrations WHERE user_id = ?").bind(id).all();
        const currentRegistration = results.reduce((acc, row) => {
            if (row.time_slot === 'morning') {
                acc.morningSession = row.session_title;
            } else if (row.time_slot === 'afternoon') {
                acc.afternoonSession = row.session_title;
            }
            return acc;
        }, { morningSession: null, afternoonSession: null });


        const availability = await getAvailability(db, allSessions, env);

        // Check for overbooking only if the session has changed
        if (morningSession && morningSession !== currentRegistration.morningSession && !availability.morning?.[morningSession]) {
            return new Response(JSON.stringify({ success: false, message: `It looks like "${morningSession}" just filled up. Please select a different morning session.` }), {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (afternoonSession && afternoonSession !== currentRegistration.afternoonSession && !availability.afternoon?.[afternoonSession]) {
            return new Response(JSON.stringify({ success: false, message: `It looks like "${afternoonSession}" just filled up. Please select a different afternoon session.` }), {
                status: 409,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        const statements = [
            db.prepare("DELETE FROM registrations WHERE user_id = ?").bind(id),
        ];

        if (morningSession) {
            statements.push(db.prepare("INSERT OR IGNORE INTO registrations (user_id, session_title, time_slot) VALUES (?, ?, 'morning')").bind(id, morningSession));
        }
        if (afternoonSession) {
            statements.push(db.prepare("INSERT OR IGNORE INTO registrations (user_id, session_title, time_slot) VALUES (?, ?, 'afternoon')").bind(id, afternoonSession));
        }

        await db.batch(statements);

        // Post-check: Verify what was actually registered
        const { results: finalRegistrations } = await db.prepare("SELECT * FROM registrations WHERE user_id = ?").bind(id).all();
        const actualMorningSession = finalRegistrations.find(row => row.time_slot === 'morning')?.session_title || null;
        const actualAfternoonSession = finalRegistrations.find(row => row.time_slot === 'afternoon')?.session_title || null;

        const messages = [];
        if (morningSession && morningSession !== actualMorningSession) {
            messages.push(`Morning session "${morningSession}" could not be registered, it might have just filled up.`);
        }
        if (afternoonSession && afternoonSession !== actualAfternoonSession) {
            messages.push(`Afternoon session "${afternoonSession}" could not be registered, it might have just filled up.`);
        }

        if (messages.length > 0) {
            return new Response(JSON.stringify({ success: false, message: messages.join(' ') }), {
                status: 409, // Conflict
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
        });
    }

    return new Response('Not Found', { status: 404 });
}
