import React, { useEffect, useRef } from "react";
import type { UiMessage } from "../../../shared/protocol.js";
import { Message } from "./Message.js";

type Props = {
  messages: UiMessage[];
  busy: boolean;
  activity?: string;
};

export function MessageList({ messages, busy, activity }: Props): React.ReactElement {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
      stick.current = distance < 80;
    };
    container.addEventListener("scroll", onScroll);
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stick.current) endRef.current?.scrollIntoView({ block: "end" });
  });

  return (
    <div className="messages" ref={containerRef}>
      {messages.map((message) => (
        <Message key={message.id} message={message} />
      ))}
      {busy ? (
        <div className="activity">
          <span className="activity__dots">
            <span />
            <span />
            <span />
          </span>
          <span className="activity__label">{activity ?? "Working…"}</span>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
