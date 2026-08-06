import { describe, expect, it } from 'vitest';
import { metresBetween, stationsWithin, walkMinutes, walkRadiusMetres } from './stations.js';
import { WALK_MINUTES_MAX } from './constants.js';

const line = (name) => ({ name, color: '#000000', tfl: true });

// A rough east-west ladder from Oxford Circus, so distances are easy to reason about.
const OXFORD_CIRCUS = { lat: 51.5152, lon: -0.1418 };
const STATIONS = [
  { name: 'Oxford Circus', lat: 51.5152, lon: -0.1418, lines: [line('Victoria line')] },
  { name: 'Bond Street', lat: 51.5142, lon: -0.1494, lines: [line('Central line')] },
  { name: 'Green Park', lat: 51.5067, lon: -0.1428, lines: [line('Piccadilly line')] },
  { name: 'Bank', lat: 51.5133, lon: -0.0886, lines: [line('Northern line')] }, // ~3.7 km: too far
  { name: 'Ghost Halt', lat: 51.5153, lon: -0.142, lines: [] } // no lines: nothing to say
];

describe('metresBetween', () => {
  it('measures London distances to within a few metres', () => {
    // Oxford Circus → Bond Street is about 530 m as the crow flies.
    expect(metresBetween(OXFORD_CIRCUS, STATIONS[1])).toBeGreaterThan(500);
    expect(metresBetween(OXFORD_CIRCUS, STATIONS[1])).toBeLessThan(560);
  });

  it('is zero at the same point', () => {
    expect(metresBetween(OXFORD_CIRCUS, OXFORD_CIRCUS)).toBe(0);
  });
});

describe('walkMinutes', () => {
  it('pads the crow-flies distance for real streets and never rounds to zero', () => {
    expect(walkMinutes(0)).toBe(1);
    expect(walkMinutes(80)).toBe(1); // 80 m straight ≈ 104 m walked ≈ 1.3 min
    expect(walkMinutes(800)).toBe(13);
    expect(walkMinutes(walkRadiusMetres())).toBe(WALK_MINUTES_MAX);
  });
});

// The root sits on Oxford Circus, so every other station is far further than the
// nearest. Tests about the other rules opt out of the reach cut.
const WIDE = { bands: [{ under: Infinity, delta: 60 }] };

// A station exactly `minutes` from DUE_NORTH_ROOT on foot. Placed a fifth of a
// minute short of the mark: it still rounds to `minutes`, but a 20-minute one
// does not land precisely on the radius, where floating point decides whether
// it is inside.
const DUE_NORTH_ROOT = { lat: 51.4, lon: -0.3 };
const stationAt = (minutes, name) => ({
  name,
  lat: DUE_NORTH_ROOT.lat + ((minutes - 0.2) * 80) / 1.3 / 110574,
  lon: DUE_NORTH_ROOT.lon,
  lines: [line(name)]
});

describe('stationsWithin', () => {
  it('lists the walkable stations nearest first, with their walk time', () => {
    const found = stationsWithin(OXFORD_CIRCUS, STATIONS, WIDE);
    expect(found.map((s) => s.name)).toEqual(['Oxford Circus', 'Bond Street', 'Green Park']);
    expect(found[0].minutes).toBe(1);
    expect(found[0].lines).toEqual([line('Victoria line')]);
  });

  it('drops a station whose every line a closer one already offers', () => {
    // Same lines as Oxford Circus next door, plus a farther stop that adds one.
    const withDuplicate = [
      ...STATIONS,
      { name: 'Regent Street', lat: 51.5148, lon: -0.1409, lines: [line('Victoria line')] },
      { name: 'Warren Street', lat: 51.5247, lon: -0.1384, lines: [line('Victoria line'), line('Northern line')] }
    ];
    const names = stationsWithin(OXFORD_CIRCUS, withDuplicate, WIDE).map((s) => s.name);
    expect(names).not.toContain('Regent Street');
    expect(names).toContain('Warren Street');
  });

  it('lists a station only for what it alone adds', () => {
    const withOverlap = [
      { name: 'Oxford Circus', lat: 51.5152, lon: -0.1418, lines: [line('Victoria line')] },
      { name: 'Green Park', lat: 51.5067, lon: -0.1428, lines: [line('Victoria line'), line('Piccadilly line')] }
    ];
    const found = stationsWithin(OXFORD_CIRCUS, withOverlap, WIDE);
    expect(found.map((s) => s.name)).toEqual(['Oxford Circus', 'Green Park']);
    // The Victoria line is already under your feet — Green Park is here for the Piccadilly.
    expect(found[1].lines.map((l) => l.name)).toEqual(['Piccadilly line']);
  });

  it('never repeats a line down the list', () => {
    const names = stationsWithin(OXFORD_CIRCUS, STATIONS, WIDE).flatMap((s) => s.lines.map((l) => l.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('a station on the doorstep still never hides one a few minutes on', () => {
    // Standing on Oxford Circus (1 min), the band alone would reach only 6 —
    // the floor keeps Bond Street, 9 minutes away, on the list.
    const found = stationsWithin(OXFORD_CIRCUS, STATIONS);
    expect(found.map((s) => s.name)).toEqual(['Oxford Circus', 'Bond Street']);
  });

  it('once the nearest station is itself a walk, allows the spread past it', () => {
    // Nearest is 17 minutes out, so 19 is a fair comparison — a tight reach
    // would have left the suburbs with a single row.
    const outerLondon = { lat: 51.4, lon: -0.3 };
    const suburbs = [
      { name: 'Far', lat: 51.4093, lon: -0.3, lines: [line('District line')] },
      { name: 'Farther', lat: 51.4108, lon: -0.3, lines: [line('Piccadilly line')] }
    ];
    const found = stationsWithin(outerLondon, suburbs);
    expect(found.map((s) => s.name)).toEqual(['Far', 'Farther']);
    expect(found[0].minutes).toBe(17);
    expect(found[1].minutes).toBe(19);
  });

  // The whole reach, one row per nearest-station walk: a 9-minute floor, +5
  // while the nearest is under 5, a flat 15 under 10, then +6.
  it.each([
    [1, 9],
    [2, 9],
    [3, 9],
    [4, 9],
    [5, 15],
    [6, 15],
    [9, 15],
    [10, 16],
    [11, 17],
    [12, 18],
    [13, 19],
    [14, 20]
  ])('with the nearest station %i minutes away, reaches %i minutes', (nearest, furthest) => {
    const candidates = [stationAt(nearest, 'nearest'), stationAt(furthest, 'edge'), stationAt(furthest + 1, 'past')];
    const names = stationsWithin(DUE_NORTH_ROOT, candidates, { limit: 0 }).map((s) => s.name);
    expect(names).toEqual(['nearest', 'edge']);
  });

  it('spends the cap on stations that add something', () => {
    const padded = [
      { name: 'A', lat: 51.5152, lon: -0.1418, lines: [line('Victoria line')] },
      { name: 'B', lat: 51.5153, lon: -0.1419, lines: [line('Victoria line')] },
      { name: 'C', lat: 51.5154, lon: -0.142, lines: [line('Victoria line')] },
      { name: 'D', lat: 51.5155, lon: -0.1421, lines: [line('Central line')] }
    ];
    expect(stationsWithin(OXFORD_CIRCUS, padded, { limit: 2 }).map((s) => s.name)).toEqual(['A', 'D']);
  });

  it('drops stations beyond the walk and stations with no lines', () => {
    const names = stationsWithin(OXFORD_CIRCUS, STATIONS, WIDE).map((s) => s.name);
    expect(names).not.toContain('Bank');
    expect(names).not.toContain('Ghost Halt');
  });

  it('honours a tighter walk', () => {
    expect(stationsWithin(OXFORD_CIRCUS, STATIONS, { maxMinutes: 2 }).map((s) => s.name)).toEqual(['Oxford Circus']);
  });

  it('caps the list', () => {
    expect(stationsWithin(OXFORD_CIRCUS, STATIONS, { ...WIDE, limit: 2 })).toHaveLength(2);
  });

  it('returns nothing for a missing root or missing data', () => {
    expect(stationsWithin(null, STATIONS)).toEqual([]);
    expect(stationsWithin({ lat: NaN, lon: 0 }, STATIONS)).toEqual([]);
    expect(stationsWithin(OXFORD_CIRCUS, null)).toEqual([]);
  });
});
