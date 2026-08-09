import { describe, expect, it } from 'vitest';
import { chainParts, splitSharedCorridors } from './rail-stack.mjs';

const line = (name, color, parts) => ({
  type: 'Feature',
  properties: { base: false, tfl: true, color, line: name },
  geometry: { type: 'MultiLineString', coordinates: parts }
});

const SHARED = [
  [0, 0],
  [1, 0]
];

describe('splitSharedCorridors', () => {
  it('leaves a line that runs alone at full width', () => {
    const out = splitSharedCorridors([line('Central', '#E32017', [SHARED])]);
    expect(out).toHaveLength(1);
    expect(out[0].properties.wf).toBeUndefined();
    expect(out[0].properties.of).toBeUndefined();
    expect(out[0].geometry.coordinates).toEqual([SHARED]);
  });

  it('gives two lines on one track half the width each, either side of centre', () => {
    const out = splitSharedCorridors([
      line('Circle', '#FFD300', [SHARED]),
      line('District', '#00782A', [SHARED])
    ]);
    expect(out.map((f) => [f.properties.line, f.properties.wf, f.properties.of])).toEqual([
      ['Circle', 0.5, -0.25],
      ['District', 0.5, 0.25]
    ]);
    // The two bands tile exactly the width one line would have had.
    const edges = out.flatMap((f) => [
      f.properties.of - f.properties.wf / 2,
      f.properties.of + f.properties.wf / 2
    ]);
    expect(Math.min(...edges)).toBe(-0.5);
    expect(Math.max(...edges)).toBe(0.5);
  });

  it('gives four lines a quarter each', () => {
    const out = splitSharedCorridors(
      ['A', 'B', 'C', 'D'].map((n, i) => line(n, `#00000${i}`, [SHARED]))
    );
    expect(out.map((f) => f.properties.wf)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(out.map((f) => f.properties.of)).toEqual([-0.375, -0.125, 0.125, 0.375]);
  });

  it('splits a line into its own track and the stretch it shares', () => {
    const solo = [
      [1, 0],
      [2, 0]
    ];
    const out = splitSharedCorridors([
      line('Circle', '#FFD300', [SHARED]),
      line('District', '#00782A', [SHARED, solo])
    ]);
    const district = out.filter((f) => f.properties.line === 'District');
    expect(district).toHaveLength(2);
    expect(district[0].properties.wf).toBeUndefined();
    expect(district[0].geometry.coordinates).toEqual([solo]);
    expect(district[1].properties.wf).toBe(0.5);
    expect(district[1].geometry.coordinates).toEqual([SHARED]);
  });

  it('orders the stack the same way wherever the lines meet', () => {
    const elsewhere = [
      [5, 5],
      [6, 5]
    ];
    const out = splitSharedCorridors([
      line('District', '#00782A', [SHARED, elsewhere]),
      line('Circle', '#FFD300', [SHARED, elsewhere])
    ]);
    const circle = out.find((f) => f.properties.line === 'Circle');
    const district = out.find((f) => f.properties.line === 'District');
    expect(circle.properties.of).toBeLessThan(district.properties.of);
    expect(circle.geometry.coordinates).toHaveLength(2);
  });
});

describe('chainParts', () => {
  it('joins ways that meet end to end', () => {
    const paths = chainParts([
      [
        [0, 0],
        [1, 0]
      ],
      [
        [1, 0],
        [2, 0]
      ]
    ]);
    expect(paths).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 0]
      ]
    ]);
  });

  it('flips a way that was digitised backwards, so the offset stays on one side', () => {
    const paths = chainParts([
      [
        [0, 0],
        [1, 0]
      ],
      [
        [2, 0],
        [1, 0]
      ]
    ]);
    expect(paths).toEqual([
      [
        [0, 0],
        [1, 0],
        [2, 0]
      ]
    ]);
  });

  it('keeps ways that never touch apart', () => {
    const a = [
      [0, 0],
      [1, 0]
    ];
    const b = [
      [5, 5],
      [6, 5]
    ];
    expect(chainParts([a, b])).toEqual([a, b]);
  });

  it('closes a loop without spinning', () => {
    const paths = chainParts([
      [
        [0, 0],
        [1, 0]
      ],
      [
        [1, 0],
        [1, 1]
      ],
      [
        [1, 1],
        [0, 0]
      ]
    ]);
    expect(paths).toHaveLength(1);
    expect(paths[0][0]).toEqual(paths[0][paths[0].length - 1]);
  });
});
