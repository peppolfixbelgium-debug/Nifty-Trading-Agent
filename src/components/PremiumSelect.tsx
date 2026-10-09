import { useEffect, useId, useRef, useState } from "react";

export type PremiumSelectOption = {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
};

type PremiumSelectProps = {
  value: string;
  options: PremiumSelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
};

export default function PremiumSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className = ""
}: PremiumSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !rootRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`premium-select ${open ? "is-open" : ""} ${className}`} ref={rootRef}>
      <button
        type="button"
        className="premium-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="premium-select-value">
          <strong>{selected?.label ?? "Choose an option"}</strong>
          {selected?.hint && <small>{selected.hint}</small>}
        </span>
        <span className="premium-select-chevron" aria-hidden="true">⌄</span>
      </button>
      {open && (
        <div className="premium-select-menu" id={listId} role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled ?? false}
              disabled={option.disabled}
              className={`premium-select-option ${option.value === value ? "is-selected" : ""}`}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span className="premium-select-option-copy">
                <strong>{option.label}</strong>
                {option.hint && <small>{option.hint}</small>}
              </span>
              <span className="premium-select-radio" aria-hidden="true">
                {option.value === value ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
