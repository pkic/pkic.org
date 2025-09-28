
export async function onRequest({ request, env, params }) {
    return new Response('Not Found', { status: 404 });
}
