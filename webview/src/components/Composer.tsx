import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";

export type ComposerHandle = { focus(): void };

type Props = {
  disabled?: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
};

const MAX_HEIGHT = 200;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { disabled, busy, onSend, onAbort },
  ref,
): React.ReactElement {
  const [text, setText] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const submit = useCallback(() => {
    const value = text.trim();
    if (!value || disabled || busy) return;
    onSend(value);
    setText("");
  }, [text, disabled, busy, onSend]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
    [submit],
  );

  return (
    <div className="composer">
      <div className="composer__box">
        <textarea
          ref={textarea}
          className="composer__input"
          placeholder={disabled ? "Connecting…" : "Ask OpenCode…  (Enter to send, Shift+Enter for newline)"}
          value={text}
          disabled={disabled}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {busy ? (
          <button type="button" className="composer__button composer__button--stop" onClick={onAbort} title="Stop">
            <StopIcon />
          </button>
        ) : (
          <button
            type="button"
            className="composer__button"
            onClick={submit}
            disabled={disabled || text.trim().length === 0}
            title="Send"
          >
            <SendIcon />
          </button>
        )}
      </div>
    </div>
  );
});

function SendIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 8 13.5 2.5 11 13.5 8.2 9.3 2.5 8Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}
