"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

export function FormDialog({
  open,
  title,
  description,
  children,
  onClose,
  wide = false,
  className = "",
  initialFocusSelector,
}: {
  open: boolean;
  title: string;
  description: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  initialFocusSelector?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const dialogId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (initialFocusSelector) dialog.querySelector<HTMLElement>(initialFocusSelector)?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open, initialFocusSelector]);

  return (
    <dialog aria-labelledby={`${dialogId}-title`} aria-describedby={`${dialogId}-description`} className={`form-dialog${wide ? " wide-dialog" : ""} ${className}`} ref={dialogRef} onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <h2 id={`${dialogId}-title`}>{title}</h2>
          <p id={`${dialogId}-description`}>{description}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close dialog">
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
