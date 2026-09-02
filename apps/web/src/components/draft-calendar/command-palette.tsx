"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";

export type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  run: () => void;
};

type CommandPaletteProps = {
  commands: Command[];
  onClose: () => void;
};

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? commands.filter((command) => command.label.toLowerCase().includes(needle))
      : commands;
  }, [commands, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Clamped rather than reset in an effect: the list can shrink under the cursor as the
  // query narrows, and a stale index would run the wrong command on Enter.
  const activeIndex = Math.min(active, Math.max(matches.length - 1, 0));

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      matches[activeIndex]?.run();
    }
  }

  return (
    <>
      <div className="console-scrim" onClick={onClose} />
      <div
        aria-label="Draft calendar commands"
        className="console-palette"
        role="dialog"
        onKeyDown={onKeyDown}
      >
        <div className="console-palette-input">
          <Search aria-hidden="true" size={16} />
          <input
            aria-label="Search draft calendar commands"
            placeholder="Type a command…"
            ref={inputRef}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          />
          <kbd>esc</kbd>
        </div>
        {matches.length ? (
          <ul>
            {matches.map((command, index) => (
              <li key={command.id}>
                <button
                  className={index === activeIndex ? "on" : undefined}
                  type="button"
                  onClick={command.run}
                  onMouseEnter={() => setActive(index)}
                >
                  {command.icon}
                  {command.label}
                  {command.hint ? <em>{command.hint}</em> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="console-palette-empty">No command matches that.</p>
        )}
      </div>
    </>
  );
}
