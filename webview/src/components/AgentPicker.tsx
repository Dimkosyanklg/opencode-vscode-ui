import React, { useEffect, useRef, useState } from "react";
import type { UiAgent } from "../../../shared/protocol.js";

type Props = {
  agents: UiAgent[];
  selected?: string;
  loading?: boolean;
  disabled?: boolean;
  onSelect: (id: string) => void;
};

/** Compact dropdown for the active OpenCode mode (Build, Plan, …). */
export function AgentPicker({ agents, selected, loading, disabled, onSelect }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = agents.find((agent) => agent.id === selected);
  const label = current?.name ?? (loading ? "Loading…" : agents.length ? "Select mode" : "No modes");

  return (
    <div className="picker picker--agent" ref={rootRef}>
      <button
        type="button"
        className={`picker__button${open ? " is-open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        title={current ? `Mode: ${current.name}${current.description ? ` — ${current.description}` : ""}` : "Select mode"}
      >
        {loading && !current ? (
          <span className="spinner spinner--xs" />
        ) : (
          <span className="picker__icon">
            <AgentIcon id={current?.id} />
          </span>
        )}
        <span className="picker__label">{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="picker__chevron">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className="picker__popover picker__popover--agent" role="listbox">
          <div className="picker__group-title">Mode</div>
          <div className="picker__scroll">
            {agents.length === 0 ? (
              <div className="picker__empty">{loading ? "Loading modes…" : "No modes available."}</div>
            ) : (
              agents.map((agent) => (
                <button
                  type="button"
                  key={agent.id}
                  role="option"
                  aria-selected={agent.id === selected}
                  className={`picker__item${agent.id === selected ? " is-selected" : ""}`}
                  onClick={() => {
                    onSelect(agent.id);
                    setOpen(false);
                  }}
                >
                  <span className="picker__item-row">
                    <span className="picker__item-icon">
                      <AgentIcon id={agent.id} />
                    </span>
                    <span className="picker__item-name">{agent.name}</span>
                  </span>
                  {agent.description ? <span className="picker__item-meta">{agent.description}</span> : null}
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AgentIcon({ id }: { id?: string }): React.ReactElement {
  switch (id) {
    case "build":
      return <BuildIcon />;
    case "plan":
      return <PlanIcon />;
    default:
      return <SparkIcon />;
  }
}

function BuildIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10.9 2.1a3.4 3.4 0 0 0-4.3 4.3L2.4 10.6a1.6 1.6 0 1 0 2.3 2.3l4.2-4.2a3.4 3.4 0 0 0 4.3-4.3L10.8 6.6 9.4 5.2l1.5-1.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M5 3.2h6A1.3 1.3 0 0 1 12.3 4.5v8A1.3 1.3 0 0 1 11 13.8H5a1.3 1.3 0 0 1-1.3-1.3v-8A1.3 1.3 0 0 1 5 3.2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M6.6 1.9h2.8a.7.7 0 0 1 .7.7v1.2a.7.7 0 0 1-.7.7H6.6a.7.7 0 0 1-.7-.7V2.6a.7.7 0 0 1 .7-.7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M5.8 7.2h4.4M5.8 9.3h4.4M5.8 11.4h2.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function SparkIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.2 9.3 6.7 13.8 8 9.3 9.3 8 13.8 6.7 9.3 2.2 8 6.7 6.7Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
