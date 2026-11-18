/**
 * `public/geo.js`: distances, projection, fitting and tiles
 * (requirements 4.9, 5.3, 5.4; QW-P1 to QW-P4).
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  haversineKm, destination, project, unproject, toView, circlePoints, fitZoom, tilesFor, circlePath,
  markerRadius, stepFor, gridLines, wrapLongitude, MAGNITUDE_STEPS, DEFAULT_VIEWPORT, FIT_PADDING, MAX_ZOOM,
} from "../public/geo.js";

const RUNS = { numRuns: 150 };

describe("overlay and tiles share one coordinate system", () => {
  const viewportArb = fc.integer({ min: 280, max: 640 }).map((width) => ({ width, height: Math.round(width * 0.75) }));
  const zoomArb = fc.integer({ min: 0, max: MAX_ZOOM });

  it("the center coordinate lands on the middle of the viewport", () => {
    fc.assert(
      fc.property(point(80), zoomArb, viewportArb, (center, zoom, vp) => {
        const v = toView(center, center, zoom, vp);
        expect(v.x).toBeCloseTo(vp.width / 2, 6);
        expect(v.y).toBeCloseTo(vp.height / 2, 6);
      }),
      { numRuns: 200 },
    );
  });

  it("a tile corner maps to the pixel where that tile is drawn", () => {
    fc.assert(
      fc.property(point(80), zoomArb, viewportArb, (center, zoom, vp) => {
        const tiles = tilesFor(center, zoom, vp);
        expect(tiles.length).toBeGreaterThan(0);
        const n = 2 ** zoom;
        for (const tile of tiles) {
          // Geographic position of the tile's top-left corner, in the tiles' own scheme.
          const corner = unproject(tile.x * 256, tile.y * 256, zoom);
          const v = toView(center, corner, zoom, vp);
          // The drawn tile may be a wrapped copy of the world, so compare modulo one world.
          const world = 256 * n;
          const dx = (((v.x - tile.left) % world) + world * 1.5) % world - world / 2;
          expect(Math.abs(dx)).toBeLessThan(1e-6);
          expect(v.y).toBeCloseTo(tile.top, 6);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("the tiles cover the whole viewport", () => {
    fc.assert(
      fc.property(point(80), zoomArb, viewportArb, (center, zoom, vp) => {
        const tiles = tilesFor(center, zoom, vp);
        const minLeft = Math.min(...tiles.map((t) => t.left));
        const maxRight = Math.max(...tiles.map((t) => t.left + 256));
        expect(minLeft).toBeLessThanOrEqual(1e-6);
        expect(maxRight).toBeGreaterThanOrEqual(vp.width - 1e-6);
      }),
      { numRuns: 200 },
    );
  });
});
const lat = (max = 90) => fc.double({ min: -max, max, noNaN: true, noDefaultInfinity: true });
const lon = fc.double({ min: -180, max: 180, noNaN: true, noDefaultInfinity: true });
const point = (max = 90) => fc.record({ latitude: lat(max), longitude: lon });

describe("haversineKm (4.9)", () => {
  it("Istanbul to Ankara is about 350 km", () => {
    const d = haversineKm({ latitude: 41.0082, longitude: 28.9784 }, { latitude: 39.9334, longitude: 32.8597 });
    expect(d).toBeGreaterThan(340);
    expect(d).toBeLessThan(360);
  });
  it("London to Paris is about 344 km, and the poles are half the circumference apart", () => {
    expect(haversineKm({ latitude: 51.5074, longitude: -0.1278 }, { latitude: 48.8566, longitude: 2.3522 })).toBeCloseTo(343.6, 0);
    expect(haversineKm({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 })).toBeCloseTo(20015.09, 1);
  });
  it("one degree of latitude is about 111.2 km", () => {
    expect(haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 })).toBeCloseTo(111.19, 1);
  });
  it("is the short way across the antimeridian", () => {
    expect(haversineKm({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 })).toBeCloseTo(111.19, 1);
  });

  it("QW-P1: symmetric, zero for equal points, between 0 and 20016 km", () => {
    fc.assert(
      fc.property(point(), point(), (a, b) => {
        const d = haversineKm(a, b);
        expect(d).toBe(haversineKm(b, a));
        expect(haversineKm(a, a)).toBe(0);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(20016);
        expect(Number.isNaN(d)).toBe(false);
      }),
      RUNS,
    );
  });

  it("destination() lands the requested distance away", () => {
    fc.assert(
      fc.property(point(80), fc.double({ min: 0, max: 360, noNaN: true }), fc.double({ min: 1, max: 1000, noNaN: true }), (c, bearing, km) => {
        const d = destination(c, bearing, km);
        expect(haversineKm(c, d)).toBeCloseTo(km, 3);
        expect(d.longitude).toBeGreaterThanOrEqual(-180);
        expect(d.longitude).toBeLessThanOrEqual(180);
      }),
      RUNS,
    );
  });
});

describe("project and unproject", () => {
  it("puts (0, 0) in the middle of the world and the date line at the edges", () => {
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(project(0, -180, 2).x).toBe(0);
    expect(project(0, 180, 2).x).toBe(1024);
  });
  it("clamps latitude to the Mercator limit", () => {
    expect(project(90, 0, 3).y).toBeCloseTo(0, 6);
    expect(project(-90, 0, 3).y).toBeCloseTo(2048, 6);
  });
  it("wrapLongitude keeps values in [-180, 180)", () => {
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(0)).toBe(0);
  });

  it("QW-P2: unproject(project(p)) returns p within 1e-6 degrees, for zoom 0 to 12", () => {
    fc.assert(
      fc.property(lat(85), lon, fc.integer({ min: 0, max: 12 }), (la, lo, zoom) => {
        const { x, y } = project(la, lo, zoom);
        const back = unproject(x, y, zoom);
        expect(Math.abs(back.latitude - la)).toBeLessThan(1e-6);
        expect(Math.abs(back.longitude - lo)).toBeLessThan(1e-6);
      }),
      RUNS,
    );
  });
});

describe("toView", () => {
  const center = { latitude: 38.2, longitude: 37.2 };
  it("puts the center in the middle of the viewport", () => {
    expect(toView(center, center, 8)).toEqual({ x: 320, y: 240 });
  });
  it("north is up and east is right", () => {
    const n = toView(center, { latitude: 39, longitude: 37.2 }, 8);
    const e = toView(center, { latitude: 38.2, longitude: 38 }, 8);
    expect(n.y).toBeLessThan(240);
    expect(e.x).toBeGreaterThan(320);
  });
  it("places a point across the antimeridian next to the center", () => {
    const v = toView({ latitude: 0, longitude: 179.9 }, { latitude: 0, longitude: -179.9 }, 8);
    expect(Math.abs(v.x - 320)).toBeLessThan(100);
  });
});

describe("fitZoom (5.3)", () => {
  it("known cases: a small circle zooms in further than a big one, and it is never above 12", () => {
    expect(fitZoom(40, 10)).toBeGreaterThan(fitZoom(40, 300));
    expect(fitZoom(40, 300)).toBeGreaterThan(fitZoom(40, 1000));
    expect(fitZoom(40, 0.5)).toBe(MAX_ZOOM);
  });
  it("300 km at 38 degrees north fits at zoom 6 in the default viewport", () => {
    expect(fitZoom(38.2, 300)).toBe(6);
  });

  it("QW-P3: the whole circle is inside the viewport at fitZoom, and not inside the padded viewport one level higher", () => {
    const { width, height } = DEFAULT_VIEWPORT;
    fc.assert(
      fc.property(lat(80), lon, fc.double({ min: 10, max: 1000, noNaN: true }), (la, lo, radius) => {
        const center = { latitude: la, longitude: lo };
        const zoom = fitZoom(la, radius);
        expect(Number.isInteger(zoom)).toBe(true);
        expect(zoom).toBeGreaterThanOrEqual(0);
        expect(zoom).toBeLessThanOrEqual(12);
        for (const p of circlePoints(center, radius, 360)) {
          const v = toView(center, p, zoom);
          expect(v.x).toBeGreaterThanOrEqual(0);
          expect(v.x).toBeLessThanOrEqual(width);
          expect(v.y).toBeGreaterThanOrEqual(0);
          expect(v.y).toBeLessThanOrEqual(height);
        }
        if (zoom < 12) {
          const outside = circlePoints(center, radius).some((p) => {
            const v = toView(center, p, zoom + 1);
            return v.x < FIT_PADDING || v.x > width - FIT_PADDING || v.y < FIT_PADDING || v.y > height - FIT_PADDING;
          });
          expect(outside).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("uses a smaller viewport when asked", () => {
    expect(fitZoom(40, 300, { width: 320, height: 240 })).toBeLessThan(fitZoom(40, 300));
  });
});

describe("tilesFor (5.4)", () => {
  it("returns one tile at zoom 0, repeated across the width", () => {
    const tiles = tilesFor({ latitude: 0, longitude: 0 }, 0);
    expect(tiles.every((t) => t.z === 0 && t.x === 0 && t.y === 0)).toBe(true);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });
  it("gives pixel offsets that match the tile grid", () => {
    const tiles = tilesFor({ latitude: 38.2, longitude: 37.2 }, 6);
    expect(tiles.length).toBeGreaterThan(0);
    for (const t of tiles) {
      expect(t.left).toBeGreaterThan(-256);
      expect(t.left).toBeLessThan(640);
      expect(t.top).toBeGreaterThan(-256);
      expect(t.top).toBeLessThan(480);
    }
    const lefts = [...new Set(tiles.map((t) => t.left))].sort((a, b) => a - b);
    for (let i = 1; i < lefts.length; i += 1) expect(lefts[i] - lefts[i - 1]).toBeCloseTo(256, 6);
  });
  it("wraps x across the date line", () => {
    const tiles = tilesFor({ latitude: 0, longitude: 179.9 }, 5);
    expect(tiles.map((t) => t.x)).toContain(0);
    expect(tiles.map((t) => t.x)).toContain(31);
  });

  it("QW-P4: at most 16 tiles, x and y inside [0, 2^z)", () => {
    fc.assert(
      fc.property(lat(90), lon, fc.integer({ min: 0, max: 12 }), (la, lo, zoom) => {
        const tiles = tilesFor({ latitude: la, longitude: lo }, zoom);
        expect(tiles.length).toBeLessThanOrEqual(16);
        for (const t of tiles) {
          expect(t.z).toBe(zoom);
          expect(Number.isInteger(t.x) && t.x >= 0 && t.x < 2 ** zoom).toBe(true);
          expect(Number.isInteger(t.y) && t.y >= 0 && t.y < 2 ** zoom).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it("the tiles cover every pixel of the viewport when the view is inside the map", () => {
    fc.assert(
      fc.property(lat(55), lon, fc.integer({ min: 4, max: 12 }), fc.double({ min: 0, max: 0.999, noNaN: true }), fc.double({ min: 0, max: 0.999, noNaN: true }), (la, lo, zoom, fx, fy) => {
        const tiles = tilesFor({ latitude: la, longitude: lo }, zoom);
        const px = fx * 640;
        const py = fy * 480;
        expect(tiles.some((t) => px >= t.left && px < t.left + 256 && py >= t.top && py < t.top + 256)).toBe(true);
      }),
      RUNS,
    );
  });
});

describe("circlePath", () => {
  const center = { latitude: 38.2, longitude: 37.2 };
  it("is a closed SVG path of 90 points, starting due north of the center", () => {
    const d = circlePath(center, 300, 6);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith(" Z")).toBe(true);
    expect(d.match(/[ML]/g)).toHaveLength(90);
    const [x, y] = d.slice(1).split(" ");
    expect(Number(x)).toBeCloseTo(320, 0);
    expect(Number(y)).toBeLessThan(240);
    expect(d).not.toMatch(/NaN|undefined/);
  });
});

describe("markers (4.11)", () => {
  it("radius grows with magnitude, is capped, and is defined for a null magnitude", () => {
    expect(markerRadius(2.5)).toBe(11.5);
    expect(markerRadius(5)).toBe(19);
    expect(markerRadius(9)).toBe(30);
    expect(markerRadius(null)).toBe(4);
    expect(markerRadius(-1)).toBe(4);
    expect(markerRadius(NaN)).toBe(4);
  });
  it("steps rise with magnitude, and every step has a text label", () => {
    expect(stepFor(2.9).label).toBe("under 3");
    expect(stepFor(3).label).toBe("3 to 3.9");
    expect(stepFor(4.99).label).toBe("4 to 4.9");
    expect(stepFor(6.5).label).toBe("6 or more");
    expect(stepFor(null)).toBe(MAGNITUDE_STEPS[0]);
    expect(MAGNITUDE_STEPS.every((s) => s.label && /^#[0-9a-f]{6}$/.test(s.color))).toBe(true);
  });
});

describe("gridLines (5.2)", () => {
  it("returns a few lines inside the viewport, for any center", () => {
    fc.assert(
      fc.property(lat(80), lon, fc.integer({ min: 2, max: 12 }), (la, lo, zoom) => {
        const lines = gridLines({ latitude: la, longitude: lo }, zoom);
        expect(lines.filter((l) => l.kind === "lat").length).toBeLessThanOrEqual(12);
        expect(lines.filter((l) => l.kind === "lon").length).toBeLessThanOrEqual(12);
        for (const l of lines) {
          expect(l.position).toBeGreaterThanOrEqual(0);
          expect(l.position).toBeLessThanOrEqual(l.kind === "lat" ? 480 : 640);
          expect(Number.isFinite(l.value)).toBe(true);
        }
      }),
      RUNS,
    );
  });
  it("labels lines with round degrees", () => {
    const lines = gridLines({ latitude: 38.2, longitude: 37.2 }, 6);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(Number.isInteger(l.value * 20)).toBe(true);
  });
});
