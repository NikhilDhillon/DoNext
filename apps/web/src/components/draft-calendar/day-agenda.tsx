"use client";

import { ChevronRight, GripVertical, Lock, Plus } from "lucide-react";
import type { ReactNode } from "react";

import type { ScheduleBlock } from "@/lib/types";

export type AgendaRow =
  | { kind: "gap"; key: string; clock: string; meridiem: string; label: string; onAdd: () => void }
  | {
    kind: "event";
    key: string;
    clock: string;
    meridiem: string;
    tone: string;
    icon: ReactNode;
    eyebrow: string;
    title: string;
    detail: string;
    locked: boolean;
    block: ScheduleBlock | null;
  };

export type AgendaDay = {
  date: string;
  weekday: string;
  dayNumber: number;
  today: boolean;
  outside: boolean;
  load: number;
};

type DayAgendaProps = {
  days: AgendaDay[];
  activeDate: string;
  heading: string;
  summary: string;
  rows: AgendaRow[];
  outside: boolean;
  onSelectDay: (index: number) => void;
  onSelectBlock: (block: ScheduleBlock) => void;
  onAdd: () => void;
};

export function DayAgenda({
  days,
  activeDate,
  heading,
  summary,
  rows,
  outside,
  onSelectDay,
  onSelectBlock,
  onAdd,
}: DayAgendaProps) {
  return (
    <div className="console-agenda">
      <div className="console-agenda-days" role="tablist" aria-label="Choose a day">
        {days.map((day, index) => (
          <button
            aria-label={`${day.weekday} ${day.dayNumber}${day.outside ? ", outside the draft" : `, ${day.load} scheduled`}`}
            aria-selected={day.date === activeDate}
            className={`${day.date === activeDate ? "on" : ""}${day.today ? " today" : ""}${day.outside ? " outside" : ""}`}
            key={day.date}
            role="tab"
            type="button"
            onClick={() => onSelectDay(index)}
          >
            <span>{day.weekday}</span>
            <strong>{day.dayNumber}</strong>
            <i aria-hidden="true">
              {Array.from({ length: 4 }, (_, slot) => (
                <em className={slot < Math.min(day.load, 4) ? "on" : undefined} key={slot} />
              ))}
            </i>
          </button>
        ))}
      </div>

      <div className="console-agenda-head">
        <h4>{heading}</h4>
        <span>{summary}</span>
      </div>

      {outside ? (
        <p className="console-agenda-note">
          <Lock size={15} /> This day sits outside the 14-day draft, so nothing can be scheduled here yet.
        </p>
      ) : rows.length ? (
        <div className="console-agenda-rows">
          {rows.map((row) => (
            <div className="console-agenda-row" key={row.key}>
              <span className="console-agenda-time">{row.clock}<em>{row.meridiem}</em></span>
              {row.kind === "gap" ? (
                <button className="console-agenda-open" type="button" onClick={row.onAdd}>
                  <Plus size={14} /> {row.label}
                </button>
              ) : row.block ? (
                <button
                  aria-label={`${row.title}, editable draft block, ${row.detail}`}
                  className={`console-agenda-event ${row.tone} editable`}
                  type="button"
                  onClick={() => onSelectBlock(row.block as ScheduleBlock)}
                >
                  <span className="console-agenda-body">
                    <span className="console-agenda-kind">{row.icon}{row.eyebrow}</span>
                    <strong>{row.title}</strong>
                    <small>{row.detail}</small>
                  </span>
                  {row.locked ? <Lock size={15} /> : <GripVertical size={15} />}
                  <ChevronRight aria-hidden="true" size={16} />
                </button>
              ) : (
                <div className={`console-agenda-event ${row.tone}`}>
                  <span className="console-agenda-body">
                    <span className="console-agenda-kind">{row.icon}{row.eyebrow}</span>
                    <strong>{row.title}</strong>
                    <small>{row.detail}</small>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="console-agenda-note">Nothing scheduled on this day.</p>
      )}

      <button className="console-agenda-add" disabled={outside} type="button" onClick={onAdd}>
        <Plus size={17} /> New block
      </button>
    </div>
  );
}
