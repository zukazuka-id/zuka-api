import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { outlet, restaurant } from "../db/schema.js";

export type LifecycleStatus = "pending" | "active" | "suspended" | "archived";

export type ManualCloseReopenStrategy = "next_hours" | "custom" | "indefinite";

export type OutletAvailabilityInput = {
  outlet: {
    status: LifecycleStatus | string | null;
    operatingHours?: Record<string, unknown> | null;
    isManuallyClosed: boolean | null;
    manualCloseReopenStrategy: ManualCloseReopenStrategy | null;
    manualCloseReopenAt: Date | string | null;
  };
  restaurant: {
    status: LifecycleStatus | string | null;
  };
  now?: Date;
};

const forcedClosedStatuses = new Set<LifecycleStatus>([
  "pending",
  "suspended",
  "archived",
]);

function isForcedClosed(status: LifecycleStatus | string | null | undefined): boolean {
  return !status || forcedClosedStatuses.has(status as LifecycleStatus);
}

function toTimeValue(value: Date | string | null): number | null {
  if (!value) {
    return null;
  }

  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function toMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

function toRanges(value: unknown): Array<{ start: number; end: number }> {
  if (Array.isArray(value)) {
    if (
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    ) {
      const start = toMinutes(value[0]);
      const end = toMinutes(value[1]);
      return start === null || end === null ? [] : [{ start, end }];
    }

    return value.flatMap((entry) => toRanges(entry));
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const startValue = typeof record.open === "string"
      ? record.open
      : typeof record.start === "string"
        ? record.start
        : null;
    const endValue = typeof record.close === "string"
      ? record.close
      : typeof record.end === "string"
        ? record.end
        : null;

    if (!startValue || !endValue) {
      return [];
    }

    const start = toMinutes(startValue);
    const end = toMinutes(endValue);
    return start === null || end === null ? [] : [{ start, end }];
  }

  return [];
}

function getDayRanges(
  operatingHours: Record<string, unknown> | null | undefined,
  dayIndex: number
): Array<{ start: number; end: number }> {
  if (!operatingHours) {
    return [];
  }

  const key = dayKeys[dayIndex];
  const variants = [
    key,
    key.toUpperCase(),
    key[0].toUpperCase() + key.slice(1),
  ];

  const rawValue = variants
    .map((variant) => operatingHours[variant])
    .find((value) => value !== undefined);

  return toRanges(rawValue);
}

function isOpenForRanges(
  ranges: Array<{ start: number; end: number }>,
  minutesSinceMidnight: number
): boolean {
  return ranges.some(({ start, end }) => {
    if (start === end) {
      return false;
    }

    if (start < end) {
      return minutesSinceMidnight >= start && minutesSinceMidnight < end;
    }

    return minutesSinceMidnight >= start || minutesSinceMidnight < end;
  });
}

export function isCurrentlyOpen(
  operatingHours: Record<string, unknown> | null | undefined,
  now = new Date()
): boolean {
  if (!operatingHours) {
    return true;
  }

  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const todayRanges = getDayRanges(operatingHours, now.getDay());
  if (isOpenForRanges(todayRanges, minutesSinceMidnight)) {
    return true;
  }

  const yesterdayRanges = getDayRanges(operatingHours, (now.getDay() + 6) % 7);
  return yesterdayRanges.some(({ start, end }) => start > end && minutesSinceMidnight < end);
}

export function getNextOpenTime(
  operatingHours: Record<string, unknown> | null | undefined,
  now = new Date()
): Date | null {
  if (!operatingHours) {
    return null;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (let dayOffset = 0; dayOffset < 8; dayOffset += 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + dayOffset);

    const ranges = getDayRanges(operatingHours, day.getDay())
      .filter(({ start, end }) => start !== end)
      .sort((left, right) => left.start - right.start);

    for (const range of ranges) {
      if (dayOffset === 0 && range.start <= currentMinutes) {
        continue;
      }

      const nextOpen = new Date(day);
      nextOpen.setMinutes(range.start);
      return nextOpen;
    }
  }

  return null;
}

export function shouldClearManualClose(input: OutletAvailabilityInput): boolean {
  if (!input.outlet.isManuallyClosed) {
    return false;
  }

  if (input.outlet.manualCloseReopenStrategy === "indefinite") {
    return false;
  }

  const reopenAt = toTimeValue(input.outlet.manualCloseReopenAt);
  if (reopenAt === null) {
    return false;
  }

  return reopenAt <= (input.now?.getTime() ?? Date.now());
}

export function computeOutletIsOpen(input: OutletAvailabilityInput): boolean {
  if (isForcedClosed(input.restaurant.status) || isForcedClosed(input.outlet.status)) {
    return false;
  }

  if (input.outlet.isManuallyClosed) {
    if (!shouldClearManualClose(input)) {
      return false;
    }
  }

  return isCurrentlyOpen(input.outlet.operatingHours, input.now);
}

export const computeOutletAvailability = computeOutletIsOpen;

export async function reconcileOutletAvailability(now = new Date()): Promise<number> {
  const rows = await db
    .select({
      id: outlet.id,
      status: outlet.status,
      isOpen: outlet.isOpen,
      operatingHours: outlet.operatingHours,
      isManuallyClosed: outlet.isManuallyClosed,
      manualCloseReopenStrategy: outlet.manualCloseReopenStrategy,
      manualCloseReopenAt: outlet.manualCloseReopenAt,
      restaurantStatus: restaurant.status,
    })
    .from(outlet)
    .innerJoin(restaurant, eq(restaurant.id, outlet.restaurantId));

  let updatedCount = 0;

  for (const row of rows) {
    const input: OutletAvailabilityInput = {
      outlet: {
        status: row.status,
        operatingHours: (row.operatingHours as Record<string, unknown> | null | undefined) ?? null,
        isManuallyClosed: row.isManuallyClosed,
        manualCloseReopenStrategy: row.manualCloseReopenStrategy as ManualCloseReopenStrategy | null,
        manualCloseReopenAt: row.manualCloseReopenAt,
      },
      restaurant: {
        status: row.restaurantStatus,
      },
      now,
    };

    const nextIsOpen = computeOutletIsOpen(input);
    const clearManualClose = shouldClearManualClose(input);
    const updates: Record<string, unknown> = {};

    if (row.isOpen !== nextIsOpen) {
      updates.isOpen = nextIsOpen;
    }

    if (clearManualClose) {
      updates.isManuallyClosed = false;
      updates.manualCloseReopenStrategy = "indefinite";
      updates.manualCloseReopenAt = null;
    }

    if (Object.keys(updates).length === 0) {
      continue;
    }

    await db.update(outlet).set(updates).where(eq(outlet.id, row.id));
    updatedCount += 1;
  }

  return updatedCount;
}
