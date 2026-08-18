/**
 * Cloudflare Worker — Trafiklab Realtime API proxy
 * Paste this into the Cloudflare dashboard editor (no build step needed).
 *
 * Get a key at https://developer.trafiklab.se → create a project → add the
 * "Trafiklab Realtime APIs" product (one key covers both Timetables/departures
 * and Stop Lookup/search — this replaces the old ResRobot v2.1 key, which
 * never returned real-time (rtTime) data for these stops).
 *
 * After saving, go to Settings → Variables → add:
 *   REALTIME_KEY = <your key>   (mark as Encrypted)
 */

const REALTIME = 'https://realtime-api.trafiklab.se/v1';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(request.url);

  // /departures/<stopId>  -> live departures for a stop
  // /stops/name/<query>   -> stop search by name
  const isDepartures = url.pathname.startsWith('/departures/');
  const isStopSearch = url.pathname.startsWith('/stops/name/');

  if (!isDepartures && !isStopSearch) {
    return new Response('Not found', { status: 404, headers: corsHeaders() });
  }

  const upstream = `${REALTIME}${url.pathname}?key=${REALTIME_KEY}`;
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
