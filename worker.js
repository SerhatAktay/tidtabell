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
 * /journey reuses RESROBOT_KEY: it finds a departure on ResRobot's
 * departureBoard (the Realtime API's trip_id is not a ResRobot id) and
 * returns the stops it passes, with coordinates, for the map view. Uses
 * departureBoard's passlist=1 — v2.1 has no journeyDetail endpoint.
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

  if (url.pathname === '/journey') return journey(url);

  if (!isDepartures && !isStopSearch) {
    return new Response('Not found', { status: 404, headers: corsHeaders() });
  }

  const upstream = `${REALTIME}${url.pathname}?key=${REALTIME_KEY}`;
  return proxy(upstream);
}

// /journey?stop=<extId>&line=<designation>&dir=<direction>&time=<scheduled ISO>
// -> { stops: [{ name, lat, lon }, ...] }  (empty if no departure matched)
async function journey(url) {
  const q = k => url.searchParams.get(k) || '';
  const [stop, line, dir, time] = ['stop', 'line', 'dir', 'time'].map(q);
  if (!stop || !line || !time) return json({ stops: [] }, 400);

  try {
    const board = await (await fetch(`${RESROBOT}/departureBoard?` + new URLSearchParams({
      id: stop, date: time.slice(0, 10), time: time.slice(11, 16),
      dur: 30, passlist: 1, format: 'json', accessId: RESROBOT_KEY,
    }))).json();

    const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
    const want = mins(time.slice(11, 16));
    const hits = (board.Departure || []).filter(d => {
      const num = d.ProductAtStop?.displayNumber || d.ProductAtStop?.line || '';
      const sameLine = num === line || (d.name || '').trim().endsWith(line);
      // ponytail: no midnight wrap on the time compare; a 23:59/00:01 pair won't match
      return sameLine && Math.abs(mins(d.time) - want) <= 2;
    });
    // Prefer the entry heading the same way; fall back to the first line+time match.
    const key = dir.slice(0, 5).toLowerCase();
    const hit = hits.find(d => key && (d.direction || '').toLowerCase().includes(key)) || hits[0];
    const raw = hit?.Stops?.Stop || [];
    const stops = (Array.isArray(raw) ? raw : [raw])
      .map(s => ({ name: s.name, lat: +s.lat, lon: +s.lon }))
      .filter(s => isFinite(s.lat) && isFinite(s.lon));
    return json({ stops });
  } catch (e) {
    return json({ stops: [], error: String(e.message || e) }, 502);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', ...corsHeaders() },
  });
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
