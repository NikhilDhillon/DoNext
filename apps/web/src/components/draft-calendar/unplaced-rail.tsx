"use client";

import type { PointerEvent as ReactPointerEvent } from "react";

import type { UnscheduledItem } from "@/components/draft-calendar/lib";

type UnplacedRailProps = {
  items: UnscheduledItem[];
  scheduledMinutes: number;
  requestedMinutes: number;
  onGrab: (item: UnscheduledItem, event: ReactPointerEvent<HTMLElement>) => void;
};

export function UnplacedRail({
  items,
  scheduledMinutes,
  requestedMinutes,
  onGrab,
}: UnplacedRailProps) {
  const covered = requestedMinutes > 0
    ? Math.min(Math.round((scheduledMinutes / requestedMinutes) * 100), 100)
    : 100;

  return (
    <aside className="console-rail" aria-label="Draft coverage and unplaced work">
      <div className="console-meter">
        <p>Draft coverage</p>
        <strong>{formatMinutes(scheduledMinutes)}</strong>
        <span className="console-meter-bar"><i style={{ width: `${covered}%` }} /></span>
        <small>
          of {formatMinutes(requestedMinutes)} requested
          {items.length ? ` · ${items.length} unplaced` : " · everything fits"}
        </small>
      </div>

      <p className="console-rail-heading">
        Unplaced<span>{items.length}</span>
      </p>

      {items.length ? (
        <div className="console-rail-list">
          {items.map((item) => (
            <div
              aria-label={`${item.name}, ${formatMinutes(item.remaining_minutes)} unplaced. ${item.reason} Drag onto the calendar to schedule it.`}
              className="console-rail-item"
              key={item.id}
              role="button"
              tabIndex={0}
              onPointerDown={(event) => onGrab(item, event)}
            >
              <p><span>{formatMinutes(item.remaining_minutes)}</span></p>
              <strong>{item.name}</strong>
              <small>{item.reason}</small>
            </div>
          ))}
        </div>
      ) : (
        <p className="console-rail-empty">
          Everything the scheduler asked for fits inside your focus hours.
        </p>
      )}
    </aside>
  );
}

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
