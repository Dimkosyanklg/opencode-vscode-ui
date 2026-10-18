import React, { useState } from "react";
import type { UiForm, UiFormAnswer, UiFormField, UiFormOption } from "../../../shared/protocol.js";

type Props = {
  forms: UiForm[];
  onReply: (formID: string, answer: UiFormAnswer) => void;
  onCancel: (formID: string) => void;
};

/** Inline cards for the agent's `question` tool, with options and custom answers. */
export function QuestionPrompt({ forms, onReply, onCancel }: Props): React.ReactElement | null {
  if (forms.length === 0) return null;
  return (
    <div className="question">
      {forms.map((form) => (
        <QuestionForm key={form.id} form={form} onReply={onReply} onCancel={onCancel} />
      ))}
    </div>
  );
}

function QuestionForm({
  form,
  onReply,
  onCancel,
}: {
  form: UiForm;
  onReply: (formID: string, answer: UiFormAnswer) => void;
  onCancel: (formID: string) => void;
}): React.ReactElement {
  const [tab, setTab] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => initialAnswers(form));
  const [custom, setCustom] = useState<Record<string, string>>(() => initialCustom(form));

  const total = form.fields.length;
  const field = form.fields[Math.min(tab, total - 1)];
  const values = answers[field.key] ?? [];
  const multi = field.type === "multiselect";
  const last = tab >= total - 1;
  const customValue = custom[field.key] ?? "";
  const customPicked = customValue.trim().length > 0;

  const submit = () => {
    const answer: UiFormAnswer = {};
    for (const item of form.fields) {
      const list = answers[item.key] ?? [];
      if (!list.length) continue;
      answer[item.key] = item.type === "multiselect" ? list : list[0];
    }
    onReply(form.id, answer);
  };

  const next = () => {
    if (last) submit();
    else setTab(tab + 1);
  };

  const pick = (option: UiFormOption) => {
    if (multi) {
      setAnswers((current) => {
        const list = current[field.key] ?? [];
        const updated = list.includes(option.value)
          ? list.filter((value) => value !== option.value)
          : [...list, option.value];
        return { ...current, [field.key]: updated };
      });
      return;
    }
    setAnswers((current) => ({ ...current, [field.key]: [option.value] }));
    setCustom((current) => ({ ...current, [field.key]: "" }));
  };

  const updateCustom = (text: string) => {
    setAnswers((current) => {
      if (multi) {
        const previous = (custom[field.key] ?? "").trim();
        const list = (current[field.key] ?? []).filter((value) => value !== previous);
        if (text.trim()) list.push(text.trim());
        return { ...current, [field.key]: list };
      }
      return { ...current, [field.key]: text.trim() ? [text] : [] };
    });
    setCustom((current) => ({ ...current, [field.key]: text }));
  };

  return (
    <div className="question__card">
      <div className="question__head">
        <span className="question__icon" aria-hidden="true">
          ?
        </span>
        <span className="question__title">{form.title}</span>
        {total > 1 ? (
          <span className="question__progress">
            {tab + 1} / {total}
          </span>
        ) : null}
      </div>

      {total > 1 ? (
        <div className="question__steps" aria-hidden="true">
          {form.fields.map((item, index) => {
            const answered = (answers[item.key]?.length ?? 0) > 0;
            return (
              <span
                key={item.key}
                className={`question__step${index === tab ? " is-active" : ""}${answered ? " is-answered" : ""}`}
              />
            );
          })}
        </div>
      ) : null}

      {field.title ? <div className="question__header">{field.title}</div> : null}
      {field.description ? <div className="question__text">{field.description}</div> : null}
      <div className="question__hint">
        {multi ? "Select one or more" : "Select one"}
        {field.custom ? ", or type your own answer" : ""}
      </div>

      <div className="question__options" role={multi ? "group" : "radiogroup"}>
        {field.options.map((option) => {
          const picked = values.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={picked}
              className={`question__option${picked ? " is-picked" : ""}`}
              onClick={() => pick(option)}
            >
              <span
                className={`question__mark${multi ? " question__mark--multi" : ""}${picked ? " is-picked" : ""}`}
                aria-hidden="true"
              />
              <span className="question__option-main">
                <span className="question__option-label">{option.label}</span>
                {option.description ? <span className="question__option-desc">{option.description}</span> : null}
              </span>
            </button>
          );
        })}

        {field.custom ? (
          <label
            className={`question__option question__option--custom${customPicked ? " is-picked" : ""}`}
          >
            <span
              className={`question__mark${multi ? " question__mark--multi" : ""}${customPicked ? " is-picked" : ""}`}
              aria-hidden="true"
            />
            <input
              className="question__custom-input"
              value={customValue}
              placeholder="Type your own answer"
              aria-label="Type your own answer"
              onChange={(event) => updateCustom(event.target.value)}
            />
          </label>
        ) : null}
      </div>

      <div className="question__actions">
        <button type="button" className="question__button" onClick={() => onCancel(form.id)}>
          Dismiss
        </button>
        <div className="question__nav">
          {tab > 0 ? (
            <button type="button" className="question__button" onClick={() => setTab(tab - 1)}>
              Back
            </button>
          ) : null}
          <button type="button" className="question__button question__button--primary" onClick={next}>
            {last ? "Submit" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function initialAnswers(form: UiForm): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const field of form.fields) {
    const values = defaults(field);
    if (values.length) out[field.key] = values;
  }
  return out;
}

function initialCustom(form: UiForm): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of form.fields) {
    if (!field.custom) continue;
    const value = field.defaultValue;
    if (value && !field.options.some((option) => option.value === value)) out[field.key] = value;
  }
  return out;
}

function defaults(field: UiFormField): string[] {
  if (field.type === "multiselect") return field.defaultValues ? [...field.defaultValues] : [];
  return field.defaultValue ? [field.defaultValue] : [];
}
