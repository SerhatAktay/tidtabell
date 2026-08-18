/**
 * Cloudflare Worker — Trafiklab Realtime API + ResRobot nearby-stops proxy
 * Paste this into the Cloudflare dashboard editor (no build step needed).
 *
 * Two upstream products, two separate keys:
 *
 * 1) Trafiklab Realtime APIs — departures + stop-name search.
 *    Get a key at https://developer.trafiklab.se → create a project → add
 *    the "Trafiklab Realtime APIs" product.
 *      REALTIME_KEY = <your key>   (mark as Encrypted)
 *
 * 2) ResRobot v2.1 — location.nearbystops (coordinate-based search; the
 *    Realtime APIs above have no equivalent endpoint yet).
 *    Get a key at https://developer.trafiklab.se → create a project → add
 *    the "ResRobot v2.1" product.
 *      RESROBOT_KEY = <your key>   (mark as Encrypted)
 *
 * After saving, go to Settings → Variables and add both.
 *
 * Note: the /geocode route (nearby-a-place search) has been removed along
 * with that feature on the frontend — only /nearbystops (geolocation-based
 * "near me") remains.
 */

const REALTIME  = 'https://realtime-api.trafiklab.se/v1';
const RESROBOT  = 'https://api.resrobot.se/v2.1';

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  const url = new URL(request.url);

  // /departures/<stopId>  -> live departures for a stop (Trafiklab Realtime)
  // /stops/name/<query>   -> stop search by name (Trafiklab Realtime)
  // /nearbystops          -> stops near a lat/lon (ResRobot v2.1)
  const isDepartures = url.pathname.startsWith('/departures/');
  const isStopSearch = url.pathname.startsWith('/stops/name/');
  const isNearby      = url.pathname === '/nearbystops';

  if (isNearby) {
    const params = new URLSearchParams(url.search);
    params.set('accessId', RESROBOT_KEY);
    params.set('format', 'json');
    const upstream = `${RESROBOT}/location.nearbystops?${params.toString()}`;
    return proxy(upstream);
  }

  if (!isDepartures && !isStopSearch) {
    return new Response('Not found', { status: 404, headers: corsHeaders() });
  }

  const upstream = `${REALTIME}${url.pathname}?key=${REALTIME_KEY}`;
  return proxy(upstream);
}

async function proxy(upstream) {
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
