import { useState } from "react";

export interface SegmentOption {
  label: string;
  icon: "expand" | "collapse";
  onSelect: () => void;
}

/** Two-state segmented control: the side last chosen is shown as active. */
export default function SegmentedToggle({
  options,
  ariaLabel,
}: {
  options: [SegmentOption, SegmentOption];
  ariaLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div className="seg-toggle" role="group" aria-label={ariaLabel}>
      {options.map((o, i) => (
        <button
          key={o.label}
          type="button"
          className={`seg-toggle-btn${active === i ? " is-active" : ""}`}
          aria-pressed={active === i}
          onClick={() => {
            setActive(i);
            o.onSelect();
          }}
        >
          <svg
            className="seg-toggle-icon"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {o.icon === "expand" ? (
              <>
                <path d="M7 6l5 5 5-5" />
                <path d="M7 13l5 5 5-5" />
              </>
            ) : (
              <>
                <path d="M7 11l5-5 5 5" />
                <path d="M7 18l5-5 5 5" />
              </>
            )}
          </svg>
          {o.label}
        </button>
      ))}
    </div>
  );
}
