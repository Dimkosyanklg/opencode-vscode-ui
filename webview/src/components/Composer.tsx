import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { UiAttachment } from "../../../shared/protocol.js";

export type ComposerHandle = { focus(): void };

type Props = {
  disabled?: boolean;
  busy: boolean;
  attachments: UiAttachment[];
  onRemoveAttachment: (attachment: UiAttachment) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
};

const MAX_HEIGHT = 200;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { disabled, busy, attachments, onRemoveAttachment, onSend, onAbort },
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
    if (disabled || busy) return;
    if (!value && attachments.length === 0) return;
    onSend(value);
    setText("");
  }, [text, disabled, busy, attachments.length, onSend]);

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
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) => (
            <span className="attachment" key={`${attachment.uri}-${attachment.name}`} title={attachment.detail ?? attachment.name}>
              <span className="attachment__icon" aria-hidden="true">
                <AttachmentIcon directory={attachment.isDirectory} />
              </span>
              <span className="attachment__name">{attachment.name}</span>
              <button
                type="button"
                className="attachment__remove"
                onClick={() => onRemoveAttachment(attachment)}
                title="Remove attachment"
                aria-label={`Remove ${attachment.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
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
            disabled={disabled || (text.trim().length === 0 && attachments.length === 0)}
            title="Send (Enter)"
          >
            <EnterIcon />
          </button>
        )}
      </div>
    </div>
  );
});

function AttachmentIcon({ directory }: { directory?: boolean }): React.ReactElement {
  if (directory) {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d="M1.5 3.2A1.2 1.2 0 0 1 2.7 2h1.9l1 1.2h3.7a1.2 1.2 0 0 1 1.2 1.2v4.4A1.2 1.2 0 0 1 9.3 10H2.7a1.2 1.2 0 0 1-1.2-1.2V3.2Z"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path
        d="M3 1.5h4L9.5 4v6.5A.5.5 0 0 1 9 11H3a.5.5 0 0 1-.5-.5v-8A.5.5 0 0 1 3 2.5Z"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
      <path d="M7 1.5V4h2.5" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  );
}

function EnterIcon(): React.ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M13 4.5v5H5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.5 7 5 9.5 7.5 12"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
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
