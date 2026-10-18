import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { UiAttachment, UiFileSuggestion } from "../../../shared/protocol.js";
import { onHostMessage, vscode } from "../vscode.js";
import { DirectoryIcon, FileIcon } from "./FileIcon.js";

export type ComposerHandle = { focus(): void };

type Props = {
  disabled?: boolean;
  busy: boolean;
  attachments: UiAttachment[];
  onRemoveAttachment: (attachment: UiAttachment) => void;
  onSend: (text: string) => void;
  onAbort: () => void;
};

type Mention = {
  /** Index of the `@` in the draft. */
  start: number;
  /** Text typed after `@`, used to query the host. */
  query: string;
};

const MAX_HEIGHT = 200;
const SEARCH_DEBOUNCE = 120;

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { disabled, busy, attachments, onRemoveAttachment, onSend, onAbort },
  ref,
): React.ReactElement {
  const [text, setText] = useState("");
  const [mention, setMention] = useState<Mention | null>(null);
  const [suggestions, setSuggestions] = useState<UiFileSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [searching, setSearching] = useState(false);
  const [caret, setCaret] = useState<number | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>();
  const queryRef = useRef("");

  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  // Restore the caret after inserting a mention (React owns the value).
  useEffect(() => {
    if (caret === null) return;
    const el = textarea.current;
    if (el) {
      el.focus();
      el.setSelectionRange(caret, caret);
    }
    setCaret(null);
  }, [caret]);

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const closeMention = useCallback(() => {
    queryRef.current = "";
    setMention(null);
    setSuggestions([]);
    setActiveIndex(0);
    setSearching(false);
  }, []);

  useEffect(() => {
    return onHostMessage((message) => {
      if (message.type !== "fileSuggestions") return;
      // Ignore responses for a query the user has already moved past.
      if (message.query !== queryRef.current) return;
      setSuggestions(message.files);
      setActiveIndex(0);
      setSearching(false);
    });
  }, []);

  const requestSuggestions = useCallback((query: string) => {
    queryRef.current = query;
    setSearching(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      vscode().postMessage({ type: "searchFiles", query });
    }, SEARCH_DEBOUNCE);
  }, []);

  const updateMention = useCallback(
    (value: string, caretPos: number) => {
      // A mention is an `@` token immediately before the caret, at the start
      // of the draft or after whitespace.
      const match = /(^|\s)@([^\s@]*)$/.exec(value.slice(0, caretPos));
      if (!match) {
        if (queryRef.current !== "" || mention) closeMention();
        return;
      }
      const start = match.index + match[1].length;
      const query = match[2];
      setMention({ start, query });
      requestSuggestions(query);
    },
    [closeMention, mention, requestSuggestions],
  );

  const applyMention = useCallback(
    (filePath: string) => {
      const el = textarea.current;
      if (!el || !mention) return;
      const before = text.slice(0, mention.start);
      const after = text.slice(el.selectionStart);
      const needsSpace = after.length === 0 || !/^\s/.test(after);
      const token = `@${filePath}${needsSpace ? " " : ""}`;
      setText(before + token + after);
      setCaret(before.length + token.length);
      closeMention();
    },
    [text, mention, closeMention],
  );

  const submit = useCallback(() => {
    const value = text.trim();
    if (disabled || busy) return;
    if (!value && attachments.length === 0) return;
    onSend(value);
    setText("");
    closeMention();
  }, [text, disabled, busy, attachments.length, onSend, closeMention]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (mention) {
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && suggestions.length > 0) {
          event.preventDefault();
          setActiveIndex((index) => {
            const next = event.key === "ArrowDown" ? index + 1 : index - 1;
            return (next + suggestions.length) % suggestions.length;
          });
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeMention();
          return;
        }
        if ((event.key === "Enter" || event.key === "Tab") && suggestions.length > 0) {
          event.preventDefault();
          applyMention(suggestions[Math.min(activeIndex, suggestions.length - 1)].path);
          return;
        }
      }
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        submit();
      }
    },
    [mention, suggestions, activeIndex, applyMention, closeMention, submit],
  );

  return (
    <div className="composer">
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) => (
            <span className="attachment" key={`${attachment.uri}-${attachment.name}`} title={attachment.detail ?? attachment.name}>
              <span className="attachment__icon" aria-hidden="true">
                {attachment.isDirectory ? (
                  <DirectoryIcon size={12} />
                ) : (
                  <FileIcon name={attachment.name} size={12} />
                )}
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
        {mention ? (
          <div className="mentions" role="listbox" aria-label="Files">
            {suggestions.length === 0 ? (
              <div className="mentions__empty">{searching ? "Searching files…" : "No matching files"}</div>
            ) : (
              suggestions.map((file, index) => (
                <button
                  key={file.path}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`mentions__item${index === activeIndex ? " is-active" : ""}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    applyMention(file.path);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="mentions__icon" aria-hidden="true">
                    <FileIcon name={file.name} size={14} />
                  </span>
                  <span className="mentions__name">{file.name}</span>
                  <span className="mentions__dir">{directoryOf(file.path)}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
        <textarea
          ref={textarea}
          className="composer__input"
          placeholder={
            disabled ? "Connecting…" : "Ask OpenCode…  (@ to add files, Enter to send, Shift+Enter for newline)"
          }
          value={text}
          disabled={disabled}
          rows={1}
          onChange={(event) => {
            setText(event.target.value);
            updateMention(event.target.value, event.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onBlur={closeMention}
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

function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
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
