/**
 * Cloudflare Worker — ResRobot proxy
 * Paste this into the Cloudflare dashboard editor (no build step needed).
 *
 * After saving, go to Settings → Variables → add:
 *   RESROBOT_KEY = <your key>   (mark as Encrypted)
 */

const RESROBOT = 'https://api.resrobot.se/v2.1';
const ALLOWED  = ['/departureBoard', '/location.name'];

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(request.url);

  if (!ALLOWED.includes(url.pathname)) {
    return new Response('Not found', { status: 404, headers: corsHeaders() });
  }

  const params = new URLSearchParams(url.search);
  params.delete('accessId');
  params.set('accessId', RESROBOT_KEY);
  params.set('format', 'json');

  const upstream = `${RESROBOT}${url.pathname}?${params.toString()}`;
  const response = await fetch(upstream);
  const body     = await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
