#!/usr/bin/env python3
"""Turn the SL GTFS Regional static zip into small JSON files the worker reads from R2.

usage: build_gtfs.py <sl.zip> <out_dir>

Output (all under out_dir):
  p/<key>.json   one per distinct route pattern: {"s": [[lat, lon, name], ...], "l": [[lat, lon], ...]}
                 key = hash of (stop sequence, shape id), so unchanged patterns keep their name day to day
  t/<NN>.json    trip_id -> pattern key, sharded on the last two digits of trip_id
  r/<YYYYMMDD>.json  "<line>|<train number>" -> trip_id, rail trips running that day
                 (the realtime API gives pendeltåg a different trip_id than the static feed)
"""
import csv, collections, datetime, hashlib, io, json, os, sys, zipfile
from zoneinfo import ZoneInfo

EPS = 0.00003  # shape simplification tolerance in degrees, about 3 m
RAIL = '100'   # GTFS route_type for pendeltåg
DAYS = range(-1, 4)  # build the train map for yesterday .. +3 days


def simplify(pts):
    """Douglas-Peucker. x is scaled by cos(60 deg) so degrees of lat/lon are comparable."""
    n = len(pts)
    if n < 3:
        return pts
    xy = [(p[1] * 0.5, p[0]) for p in pts]
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]
        dx, dy = xy[b][0] - ax, xy[b][1] - ay
        length = dx * dx + dy * dy
        far, far_i = 0.0, -1
        for i in range(a + 1, b):
            px, py = xy[i][0] - ax, xy[i][1] - ay
            t = 0 if length == 0 else max(0, min(1, (px * dx + py * dy) / length))
            d = (px - t * dx) ** 2 + (py - t * dy) ** 2
            if d > far:
                far, far_i = d, i
        if far > EPS * EPS:
            keep[far_i] = True
            stack += [(a, far_i), (far_i, b)]
    return [p for p, k in zip(pts, keep) if k]


def dump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)


def main(zip_path, out):
    z = zipfile.ZipFile(zip_path)
    rd = lambda name: csv.DictReader(io.TextIOWrapper(z.open(name), 'utf-8-sig'))

    routes = {r['route_id']: r for r in rd('routes.txt')}
    trips = {r['trip_id']: r for r in rd('trips.txt')}
    stops = {r['stop_id']: (round(float(r['stop_lat']), 5), round(float(r['stop_lon']), 5), r['stop_name'])
             for r in rd('stops.txt')}

    seq = collections.defaultdict(list)
    for r in rd('stop_times.txt'):
        seq[r['trip_id']].append((int(r['stop_sequence']), r['stop_id']))

    # trip -> pattern
    patterns = {}  # key -> (stop ids, shape id)
    trip_pattern = {}
    for trip_id, rows in seq.items():
        stop_ids = tuple(s for _, s in sorted(rows))
        shape_id = trips[trip_id]['shape_id'] if trip_id in trips else ''
        key = hashlib.sha1(('|'.join(stop_ids) + '#' + shape_id).encode()).hexdigest()[:10]
        patterns[key] = (stop_ids, shape_id)
        trip_pattern[trip_id] = key

    wanted = {sh for _, sh in patterns.values() if sh}
    shape_pts = collections.defaultdict(list)
    for r in rd('shapes.txt'):
        if r['shape_id'] in wanted:
            shape_pts[r['shape_id']].append(
                (int(r['shape_pt_sequence']), round(float(r['shape_pt_lat']), 5), round(float(r['shape_pt_lon']), 5)))

    for key, (stop_ids, shape_id) in patterns.items():
        line = simplify([[a, b] for _, a, b in sorted(shape_pts.get(shape_id, []))])
        dump(f'{out}/p/{key}.json', {'s': [list(stops[s]) for s in stop_ids if s in stops], 'l': line})

    shards = collections.defaultdict(dict)
    for trip_id, key in trip_pattern.items():
        shards[trip_id[-2:]][trip_id] = key
    for nn, m in shards.items():
        dump(f'{out}/t/{nn}.json', m)

    # train number -> trip_id, per day
    cal = {r['service_id']: r for r in rd('calendar.txt')}
    exc = collections.defaultdict(dict)
    for r in rd('calendar_dates.txt'):
        exc[r['service_id']][r['date']] = r['exception_type']
    weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

    def active(service_id, day):
        ymd = day.strftime('%Y%m%d')
        if ymd in exc[service_id]:
            return exc[service_id][ymd] == '1'
        c = cal.get(service_id)
        return bool(c) and c['start_date'] <= ymd <= c['end_date'] and c[weekdays[day.weekday()]] == '1'

    rail = [t for t in trips.values()
            if routes[t['route_id']]['route_type'] == RAIL and t['trip_id'] in trip_pattern]
    today = datetime.datetime.now(ZoneInfo('Europe/Stockholm')).date()
    for off in DAYS:
        day = today + datetime.timedelta(days=off)
        by_number = collections.defaultdict(list)
        for t in rail:
            if active(t['service_id'], day):
                by_number[f"{routes[t['route_id']]['route_short_name']}|{t['samtrafiken_internal_trip_number']}"].append(t['trip_id'])
        # ambiguous numbers are left out: better no map than the wrong train
        dump(f"{out}/r/{day.strftime('%Y%m%d')}.json", {k: v[0] for k, v in by_number.items() if len(v) == 1})

    print(f'{len(trips)} trips, {len(patterns)} patterns, {len(shards)} shards')


if __name__ == '__main__':
    main(*sys.argv[1:3])
