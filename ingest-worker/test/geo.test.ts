import { describe, expect, it } from "vitest";
import { haversineDistanceKm, matchingSavedPoints } from "../src/geo";

describe("haversineDistanceKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineDistanceKm(59.437, 24.7536, 59.437, 24.7536)).toBeCloseTo(0, 5);
  });

  it("returns roughly the known great-circle distance between Tallinn and Tartu (~163km)", () => {
    // Tallinn: 59.437, 24.7536 — Tartu: 58.3776, 26.7290
    const km = haversineDistanceKm(59.437, 24.7536, 58.3776, 26.729);
    expect(km).toBeGreaterThan(155);
    expect(km).toBeLessThan(175);
  });
});

describe("matchingSavedPoints", () => {
  const hazard = { lat: 59.437, lng: 24.7536, eventType: "slippery" };

  it("matches a point within its radius", () => {
    const points = [{ id: 1, lat: 59.44, lng: 24.76, radiusKm: 5, eventTypes: null }];
    expect(matchingSavedPoints(hazard, points)).toHaveLength(1);
  });

  it("excludes a point outside its radius", () => {
    const points = [{ id: 1, lat: 58.3776, lng: 26.729, radiusKm: 5, eventTypes: null }];
    expect(matchingSavedPoints(hazard, points)).toHaveLength(0);
  });

  it("respects event_types filter when set", () => {
    const points = [
      { id: 1, lat: 59.44, lng: 24.76, radiusKm: 5, eventTypes: ["accident"] },
      { id: 2, lat: 59.44, lng: 24.76, radiusKm: 5, eventTypes: ["slippery"] },
      { id: 3, lat: 59.44, lng: 24.76, radiusKm: 5, eventTypes: null },
    ];
    const matches = matchingSavedPoints(hazard, points);
    expect(matches.map((p) => p.id)).toEqual([2, 3]);
  });
});
