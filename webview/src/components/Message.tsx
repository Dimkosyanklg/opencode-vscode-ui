import React, { useState } from "react";
import type { UiMessage, UiPart } from "../../../shared/protocol.js";
import { Markdown } from "./Markdown.js";
import { ToolCard } from "./ToolCard.js";

export function Message({ message }: { message: UiMessage }): React.ReactElement | null {
  if (message.role === "user") {
    return (
      <div className="msg msg--user">
        {message.attachments && message.attachments.length > 0 ? (
          <div className="msg__attachments">
            {message.attachments.map((attachment, index) => (
              <span
                className="attachment attachment--static"
                key={`${attachment.uri}-${index}`}
                title={attachment.detail ?? attachment.name}
              >
                <span className="attachment__name">{attachment.name}</span>
              </span>
            ))}
          </div>
        ) : null}
        {message.text ? <div className="msg__bubble">{message.text}</div> : null}
      </div>
    );
  }

  if (message.role === "notice") {
    return <div className="msg msg--notice">{message.text}</div>;
  }

  return (
    <div className="msg msg--assistant">
      {message.parts.map((part, index) => (
        <Part key={index} part={part} />
      ))}
      {message.error ? <div className="msg__error">{message.error}</div> : null}
      <MessageFooter message={message} />
    </div>
  );
}

function Part({ part }: { part: UiPart }): React.ReactElement | null {
  switch (part.kind) {
    case "text":
      return part.text ? <Markdown text={part.text} /> : null;
    case "reasoning":
      return part.text ? <Reasoning text={part.text} /> : null;
    case "tool":
      return <ToolCard part={part} />;
    case "compaction":
      return <div className="msg--notice">{part.text}</div>;
    default:
      return null;
  }
}

function Reasoning({ text }: { text: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className={`reasoning${open ? " is-open" : ""}`}>
      <button type="button" className="reasoning__head" onClick={() => setOpen((v) => !v)}>
        <span className="reasoning__spark">✦</span>
        <span>Reasoning</span>
        <span className="tool__caret">{open ? "▾" : "▸"}</span>
      </button>
      {open ? <div className="reasoning__body">{text}</div> : null}
    </div>
  );
}

function MessageFooter({
  message,
}: {
  message: Extract<UiMessage, { role: "assistant" }>;
}): React.ReactElement | null {
  const bits: string[] = [];
  if (message.model) bits.push(message.model.id);
  if (message.tokens) {
    const total = message.tokens.input + message.tokens.output;
    if (total) bits.push(`${formatCount(total)} tokens`);
  }
  if (typeof message.cost === "number" && message.cost > 0) bits.push(`$${message.cost.toFixed(4)}`);
  if (message.streaming) bits.push("streaming…");
  if (!bits.length) return null;
  return <div className="msg__footer">{bits.join(" · ")}</div>;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}
