
export async function onRequest({ request, env }) {
    return new Response("Hello from the API", {
        headers: { "Content-Type": "text/plain" },
    });
}
