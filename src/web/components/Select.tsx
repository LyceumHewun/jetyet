import { ScrollArea } from "./Scrollbars";
import { t as translate } from "../i18n";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type SelectOption = {
  value: string;
  label: string;
};

type SelectGroup = {
  label: string;
  options: SelectOption[];
};

export function Select({
  id,
  "aria-describedby": ariaDescribedBy,
  value,
  options,
  onChange,
  placeholder = translate("Select…"),
  disabled = false,
  compact = false,
}: {
  id?: string;
  "aria-describedby"?: string;
  value: string;
  options: (SelectOption | SelectGroup)[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const listId = useId();
  const entries = options.flatMap((entry) =>
    "options" in entry ? entry.options : [entry],
  );
  const selectedIndex = entries.findIndex((entry) => entry.value === value);
  const current = entries[selectedIndex];
  const highlighted = entries[highlight];
  const optionId = (option: SelectOption) => `${listId}-${option.value}`;
  const activeId = open && highlighted ? optionId(highlighted) : undefined;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (activeId) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeId]);

  const showOptions = (index = Math.max(0, selectedIndex)) => {
    const rect = root.current?.getBoundingClientRect();
    if (rect)
      setDropUp(window.innerHeight - rect.bottom < 220 && rect.top > 220);
    setHighlight(index);
    setOpen(true);
    search.current = { text: "", at: 0 };
  };

  const choose = (option: SelectOption) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (key === "Tab") setOpen(false);
    if (open && key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (!open) showOptions();
      else if (highlighted) choose(highlighted);
      else setOpen(false);
      return;
    }
    if (
      key === "ArrowDown" ||
      key === "ArrowUp" ||
      key === "Home" ||
      key === "End"
    ) {
      event.preventDefault();
      const last = Math.max(0, entries.length - 1);
      if (!open && (key === "ArrowDown" || key === "ArrowUp")) {
        showOptions(selectedIndex < 0 && key === "ArrowUp" ? last : undefined);
        return;
      }
      const index =
        key === "Home"
          ? 0
          : key === "End"
            ? last
            : key === "ArrowDown"
              ? Math.min(last, highlight + 1)
              : Math.max(0, highlight - 1);
      if (open) setHighlight(index);
      else showOptions(index);
      return;
    }
    if (
      key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      const now = performance.now();
      const character = key.toLocaleLowerCase();
      const previous =
        open && now - search.current.at < 600 ? search.current.text : "";
      const text = previous === character ? character : previous + character;
      const start =
        previous && previous !== character
          ? highlight - 1
          : open
            ? highlight
            : selectedIndex;
      const next = entries.findIndex((_, offset) =>
        entries[(start + offset + 1) % entries.length].label
          .toLocaleLowerCase()
          .startsWith(text),
      );
      if (next >= 0) {
        const index = (start + next + 1) % entries.length;
        if (open) setHighlight(index);
        else showOptions(index);
      }
      search.current = { text, at: now };
    }
  };

  const renderOption = (option: SelectOption) => {
    const selected = option.value === value;
    const focused = option === highlighted;
    return (
      <button
        key={option.value}
        id={optionId(option)}
        type="button"
        role="option"
        tabIndex={-1}
        aria-selected={selected}
        className={`ui-select-option${selected ? " active" : ""}${focused ? " highlighted" : ""}`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      >
        <span>{option.label}</span>
        {selected && <Check size={13} aria-hidden="true" />}
      </button>
    );
  };

  return (
    <div
      ref={root}
      className={[
        "ui-select",
        open ? "open" : "",
        dropUp ? "drop-up" : "",
        compact ? "compact" : "",
        disabled ? "disabled" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <button
        id={id}
        type="button"
        className="ui-select-trigger"
        disabled={disabled}
        role="combobox"
        aria-label={id ? undefined : (current?.label ?? placeholder)}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        onKeyDown={onKeyDown}
        onClick={() => (open ? setOpen(false) : showOptions())}
      >
        <span className={current ? "" : "muted"}>
          {current ? current.label : placeholder}
        </span>
        <ChevronDown
          size={14}
          className="ui-select-chevron"
          aria-hidden="true"
        />
      </button>
      {open && (
        <ScrollArea
          id={listId}
          axis="y"
          className="ui-select-menu"
          role="listbox"
        >
          {entries.length ? (
            options.map((entry) =>
              "options" in entry ? (
                <div
                  key={entry.label}
                  className="ui-select-group"
                  role="group"
                  aria-label={entry.label}
                >
                  <div className="ui-select-group-label" aria-hidden="true">
                    {entry.label}
                  </div>
                  {entry.options.map(renderOption)}
                </div>
              ) : (
                renderOption(entry)
              ),
            )
          ) : (
            <div className="ui-select-empty">{translate("No options")}</div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
