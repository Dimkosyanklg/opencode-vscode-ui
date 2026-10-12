import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ModelRef, UiModel } from "../../../shared/protocol.js";

type Props = {
  models: UiModel[];
  selected?: ModelRef;
  loading?: boolean;
  disabled?: boolean;
  onSelect: (model: ModelRef | null) => void;
  onRefresh: () => void;
};

export function ModelPicker({ models, selected, loading, disabled, onSelect, onRefresh }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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
    searchRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedModel = useMemo(
    () => models.find((m) => isSelected(m.ref, selected)),
    [models, selected],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? models.filter(
          (m) =>
            m.name.toLowerCase().includes(q) ||
            m.ref.id.toLowerCase().includes(q) ||
            m.providerName.toLowerCase().includes(q),
        )
      : models;
    const byProvider = new Map<string, UiModel[]>();
    for (const model of filtered) {
      const list = byProvider.get(model.providerName) ?? [];
      list.push(model);
      byProvider.set(model.providerName, list);
    }
    for (const list of byProvider.values()) {
      list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
    }
    return [...byProvider.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [models, query]);

  const label =
    selectedModel?.name ?? (loading ? "Loading models…" : models.length === 0 ? "No models" : "Select model");

  return (
    <div className="picker" ref={rootRef}>
      <button
        type="button"
        className={`picker__button${open ? " is-open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Select model"
      >
        {loading && !selectedModel ? <span className="spinner spinner--xs" /> : null}
        <span className="picker__label">{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="picker__chevron">
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>

      {open ? (
        <div className="picker__popover" role="listbox">
          <div className="picker__search">
            <input
              ref={searchRef}
              value={query}
              placeholder="Search models…"
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="button" className="picker__refresh" onClick={onRefresh} title="Refresh models">
              ⟳
            </button>
          </div>
          <div className="picker__scroll">
            {groups.length === 0 ? (
              <div className="picker__empty">
                {query.trim() ? `No models match “${query}”.` : "No models available — click ⟳ to refresh."}
              </div>
            ) : (
              groups.map(([provider, list]) => (
                <div key={provider} className="picker__group">
                  <div className="picker__group-title">{provider}</div>
                  {list.map((model) => (
                    <button
                      type="button"
                      key={model.key}
                      className={`picker__item${isSelected(model.ref, selected) ? " is-selected" : ""}`}
                      onClick={() => {
                        onSelect(model.ref);
                        setOpen(false);
                      }}
                    >
                      <span className="picker__item-name">{model.name}</span>
                      <span className="picker__item-meta">{modelMeta(model)}</span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function isSelected(a: ModelRef, b: ModelRef | undefined): boolean {
  return Boolean(b && a.id === b.id && a.providerID === b.providerID);
}

function modelMeta(model: UiModel): string {
  const bits: string[] = [];
  if (model.limit.context) bits.push(`${formatTokens(model.limit.context)} ctx`);
  if (model.cost && model.cost.input > 0) bits.push(`$${model.cost.input}/M`);
  else bits.push("free");
  if (!model.enabled) bits.push("disabled");
  if (model.variants.length) bits.push(`${model.variants.length} var`);
  return bits.join(" · ");
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}
