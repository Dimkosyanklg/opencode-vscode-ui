import React, { useState } from "react";
import type { UiPart } from "../../../shared/protocol.js";

export function ToolCard({ part }: { part: Extract<UiPart, { kind: "tool" }> }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const input = formatInput(part.input);

  return (
    <div className={`tool tool--${part.status}`}>
      <button type="button" className="tool__head" onClick={() => setOpen((v) => !v)}>
        <span className="tool__icon">{icon(part.status)}</span>
        <span className="tool__name">{prettyToolName(part.name)}</span>
        {input ? <span className="tool__arg">{input}</span> : null}
        <span className="tool__caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div className="tool__body">
          {part.input !== undefined ? (
            <pre className="tool__pre">{safeJson(part.input)}</pre>
          ) : null}
          {part.error ? <pre className="tool__pre tool__pre--error">{part.error}</pre> : null}
          {part.output ? <pre className="tool__pre">{part.output}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

function icon(status: string): string {
  switch (status) {
    case "completed":
      return "✓";
    case "error":
      return "✕";
    case "running":
      return "◐";
    default:
      return "•";
  }
}

function prettyToolName(name: string): string {
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return truncate(input);
  if (typeof input === "object") {
    const obj = input as Record<string, unknown>;
    for (const key of ["filePath", "path", "file", "command", "pattern", "query", "url", "description"]) {
      if (typeof obj[key] === "string") return truncate(obj[key] as string);
    }
    const first = Object.values(obj).find((v) => typeof v === "string");
    if (typeof first === "string") return truncate(first);
  }
  return "";
}

function truncate(value: string): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  return oneLine.length > 64 ? `${oneLine.slice(0, 61)}…` : oneLine;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
