import React, { useEffect, useMemo, useRef, useState } from "react";
import type { UiSession } from "../../../shared/protocol.js";

type Props = {
  sessions: UiSession[];
  activeID?: string;
  loading?: boolean;
  disabled?: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: (search?: string) => void;
};

export function HistoryPicker({
  sessions = [],
  activeID,
  loading,
  disabled,
  onOpen,
  onDelete,
  onRefresh,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmID, setConfirmID] = useState<string | undefined>();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setConfirmID(undefined);
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Refresh from the server whenever the popover opens or the query changes.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => onRefresh(query.trim() || undefined), query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [open, query, onRefresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  return (
    <div className="history" ref={rootRef}>
      <button
        type="button"
        className={`icon-button${open ? " is-active" : ""}`}
        title="Chat history"
        aria-label="Chat history"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <HistoryIcon />
      </button>

      {open ? (
        <div className="history__popover">
          <div className="history__head">
            <span className="history__title">Chat history</span>
            {loading ? <span className="spinner spinner--xs" /> : null}
          </div>
          <div className="picker__search">
            <input
              ref={searchRef}
              value={query}
              placeholder="Search chats…"
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="history__scroll">
            {filtered.length === 0 ? (
              <div className="picker__empty">
                {loading ? "Loading…" : query.trim() ? "No chats match." : "No saved chats yet."}
              </div>
            ) : (
              filtered.map((session) => (
                <div
                  key={session.id}
                  className={`history__item${session.id === activeID ? " is-active" : ""}`}
                >
                  {confirmID === session.id ? (
                    <div className="history__confirm">
                      <span>Delete this chat?</span>
                      <div className="history__confirm-actions">
                        <button
                          type="button"
                          className="history__danger"
                          onClick={() => {
                            onDelete(session.id);
                            setConfirmID(undefined);
                          }}
                        >
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirmID(undefined)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="history__open"
                        onClick={() => {
                          onOpen(session.id);
                          setOpen(false);
                        }}
                      >
                        <span className="history__item-title">{session.title}</span>
                        <span className="history__item-meta">
                          {relativeTime(session.timeUpdated)}
                          {session.model ? ` · ${session.model.id}` : ""}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="history__delete"
                        title="Delete chat"
                        aria-label="Delete chat"
                        onClick={() => setConfirmID(session.id)}
                      >
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function relativeTime(time: number): string {
  if (!time) return "";
  const diff = Date.now() - time;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(time).toLocaleDateString();
}

function HistoryIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 4.2v4l2.6 1.5M13.2 8A5.2 5.2 0 1 1 8 2.8c1.9 0 3.6 1 4.5 2.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.6 2.6v2.8H9.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon(): React.ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.6h10M6.4 4.6V3.3a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v1.3M4.6 4.6l.55 7.5a1 1 0 0 0 1 .93h3.7a1 1 0 0 0 1-.93l.55-7.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
