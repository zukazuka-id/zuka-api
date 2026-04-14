import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  computeOutletAvailability,
  computeOutletIsOpen,
  getNextOpenTime,
  isCurrentlyOpen,
  shouldClearManualClose,
} from "../../lib/outlet-availability.js";

describe("schema alignment", () => {
  it("declares the restaurant_photo indexes that the migration creates", () => {
    const schemaSource = readFileSync(new URL("../../db/schema.ts", import.meta.url), "utf8");

    expect(schemaSource).toContain('index("restaurant_photo_restaurant_idx")');
    expect(schemaSource).toContain('index("restaurant_photo_outlet_sort_idx")');
  });
});

describe("computeOutletIsOpen", () => {
  it("forces availability false when the restaurant is archived", () => {
    expect(
      computeOutletIsOpen({
        outlet: {
          status: "active",
          operatingHours: { mon: ["09:00", "17:00"] },
          isManuallyClosed: false,
          manualCloseReopenStrategy: "indefinite",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: "archived",
        },
        now: new Date("2026-04-13T10:00:00+07:00"),
      })
    ).toBe(false);
  });

  it("returns true when an active outlet is within operating hours", () => {
    expect(
      computeOutletIsOpen({
        outlet: {
          status: "active",
          operatingHours: { mon: ["09:00", "17:00"] },
          isManuallyClosed: false,
          manualCloseReopenStrategy: "indefinite",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: "active",
        },
        now: new Date("2026-04-13T10:00:00+07:00"),
      })
    ).toBe(true);
  });

  it("returns false outside operating hours even if the restaurant is active", () => {
    expect(
      computeOutletIsOpen({
        outlet: {
          status: "active",
          operatingHours: { mon: ["09:00", "17:00"] },
          isManuallyClosed: false,
          manualCloseReopenStrategy: "indefinite",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: "active",
        },
        now: new Date("2026-04-13T20:00:00+07:00"),
      })
    ).toBe(false);
  });

  it("returns false for an indefinite manual close", () => {
    expect(
      computeOutletIsOpen({
        outlet: {
          status: "active",
          operatingHours: { mon: ["09:00", "17:00"] },
          isManuallyClosed: true,
          manualCloseReopenStrategy: "indefinite",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: "active",
        },
        now: new Date("2026-04-13T10:00:00+07:00"),
      })
    ).toBe(false);
  });

  it("stays closed before the manual reopen time and opens at the reopen time", () => {
    const now = new Date("2026-04-13T10:00:00+07:00");
    const sharedInput = {
      outlet: {
        status: "active",
        operatingHours: { mon: ["09:00", "17:00"] },
        isManuallyClosed: true,
        manualCloseReopenStrategy: "custom" as const,
      },
      restaurant: {
        status: "active" as const,
      },
      now,
    };

    expect(
      computeOutletIsOpen({
        ...sharedInput,
        outlet: {
          ...sharedInput.outlet,
          manualCloseReopenAt: new Date("2026-04-13T10:05:00+07:00"),
        },
      })
    ).toBe(false);

    expect(
      computeOutletIsOpen({
        ...sharedInput,
        outlet: {
          ...sharedInput.outlet,
          manualCloseReopenAt: new Date("2026-04-13T10:00:00+07:00"),
        },
      })
    ).toBe(true);
  });

  it("returns false when manualCloseReopenAt is missing or invalid", () => {
    expect(
      computeOutletIsOpen({
        outlet: {
          status: "active",
          operatingHours: { mon: ["09:00", "17:00"] },
          isManuallyClosed: true,
          manualCloseReopenStrategy: "custom",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: "active",
        },
        now: new Date("2026-04-13T10:00:00+07:00"),
      })
    ).toBe(false);

    expect(
      computeOutletIsOpen({
        outlet: {
          status: "active",
          operatingHours: { mon: ["09:00", "17:00"] },
          isManuallyClosed: true,
          manualCloseReopenStrategy: "custom",
          manualCloseReopenAt: "not-a-date",
        },
        restaurant: {
          status: "active",
        },
        now: new Date("2026-04-13T10:00:00+07:00"),
      })
    ).toBe(false);
  });

  it("computes next open time for the next operating window", () => {
    const nextOpen = getNextOpenTime(
      { mon: ["09:00", "17:00"], tue: ["08:00", "20:00"] },
      new Date("2026-04-13T18:00:00+07:00")
    );

    expect(nextOpen?.toISOString()).toBe("2026-04-14T01:00:00.000Z");
  });

  it("does not schedule a next-hours reopen when operating hours are missing", () => {
    expect(getNextOpenTime(null, new Date("2026-04-13T18:00:00+07:00"))).toBeNull();
    expect(
      shouldClearManualClose({
        outlet: {
          status: "active",
          operatingHours: null,
          isManuallyClosed: true,
          manualCloseReopenStrategy: "next_hours",
          manualCloseReopenAt: null,
        },
        restaurant: {
          status: "active",
        },
        now: new Date("2026-04-13T18:00:00+07:00"),
      })
    ).toBe(false);
  });

  it("clears manual close after the reopen time", () => {
    const input = {
      outlet: {
        status: "active",
        operatingHours: { mon: ["09:00", "17:00"] },
        isManuallyClosed: true,
        manualCloseReopenStrategy: "custom" as const,
        manualCloseReopenAt: "2026-04-13T10:00:00+07:00",
      },
      restaurant: {
        status: "active" as const,
      },
      now: new Date("2026-04-13T10:30:00+07:00"),
    };

    expect(shouldClearManualClose(input)).toBe(true);
    expect(computeOutletIsOpen(input)).toBe(true);
  });

  it("reports current open state from operating hours", () => {
    expect(isCurrentlyOpen({ mon: ["09:00", "17:00"] }, new Date("2026-04-13T11:00:00+07:00"))).toBe(true);
    expect(isCurrentlyOpen({ mon: ["09:00", "17:00"] }, new Date("2026-04-13T18:00:00+07:00"))).toBe(false);
  });

  it("matches the computeOutletAvailability alias", () => {
    const input = {
      outlet: {
        status: "active",
        operatingHours: { mon: ["09:00", "17:00"] },
        isManuallyClosed: false,
        manualCloseReopenStrategy: "indefinite" as const,
        manualCloseReopenAt: null,
      },
      restaurant: {
        status: "active" as const,
      },
      now: new Date("2026-04-13T10:00:00+07:00"),
    };

    expect(computeOutletAvailability(input)).toBe(computeOutletIsOpen(input));
  });
});
