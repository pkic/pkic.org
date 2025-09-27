
export async function onRequest({ request, env }) {
    return new Response("Hello from the Events API", {
        headers: { "Content-Type": "text/plain" },
    });
}
