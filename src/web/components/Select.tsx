import { ScrollArea } from "./Scrollbars";
import { t as translate } from "../i18n";
import { Check, ChevronDown } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

export type SelectOption = {
  value: string;
  label: string;
};

type SelectGroup = {
  label: string;
  options: SelectOption[];
};

type MenuPosition = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
  dropUp: boolean;
};

const VIEWPORT_PAD = 8;
const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 240;
const MENU_MIN_HEIGHT = 48;

function measureMenuPosition(el: HTMLElement): MenuPosition {
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - rect.bottom - MENU_GAP - VIEWPORT_PAD;
  const spaceAbove = rect.top - MENU_GAP - VIEWPORT_PAD;
  const dropUp = spaceBelow < 220 && spaceAbove > spaceBelow;
  const available = dropUp ? spaceAbove : spaceBelow;
  const maxHeight = Math.min(
    MENU_MAX_HEIGHT,
    Math.max(MENU_MIN_HEIGHT, Math.floor(available)),
  );
  const maxWidth = Math.max(0, vw - VIEWPORT_PAD * 2);
  const width = Math.min(rect.width, maxWidth);
  const left = Math.max(
    VIEWPORT_PAD,
    Math.min(rect.left, vw - VIEWPORT_PAD - width),
  );
  if (dropUp) {
    return {
      left,
      width,
      maxHeight,
      bottom: Math.max(
        VIEWPORT_PAD,
        Math.min(vh - VIEWPORT_PAD - maxHeight, vh - rect.top + MENU_GAP),
      ),
      dropUp: true,
    };
  }
  return {
    left,
    width,
    maxHeight,
    top: Math.max(
      VIEWPORT_PAD,
      Math.min(vh - VIEWPORT_PAD - maxHeight, rect.bottom + MENU_GAP),
    ),
    dropUp: false,
  };
}

function sameMenuPosition(a: MenuPosition | null, b: MenuPosition): boolean {
  return (
    !!a &&
    a.left === b.left &&
    a.width === b.width &&
    a.maxHeight === b.maxHeight &&
    a.top === b.top &&
    a.bottom === b.bottom &&
    a.dropUp === b.dropUp
  );
}

export function Select({
  id,
  "aria-describedby": ariaDescribedBy,
  value,
  options,
  onChange,
  placeholder = translate("Select…"),
  disabled = false,
  compact = false,
  unclipped = false,
}: {
  id?: string;
  "aria-describedby"?: string;
  value: string;
  options: (SelectOption | SelectGroup)[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
  /** Portal the menu to document.body with viewport-bounded fixed positioning to escape overflow-clipped ancestors. */
  unclipped?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
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

  const close = () => {
    setOpen(false);
    setKeyboardFocus(false);
  };

  useEffect(() => {
    if (disabled && open) close();
  }, [disabled, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const inRoot = !!root.current?.contains(target);
      const inMenu =
        unclipped && !!document.getElementById(listId)?.contains(target);
      if (!inRoot && !inMenu) close();
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, unclipped, listId]);

  useLayoutEffect(() => {
    if (!open || !unclipped) return;
    const syncPosition = () => {
      const el = root.current;
      if (!el) return;
      const next = measureMenuPosition(el);
      setDropUp(next.dropUp);
      setMenuPos((prev) => (sameMenuPosition(prev, next) ? prev : next));
    };
    syncPosition();
    const onScroll = (e: Event) => {
      const menuEl = document.getElementById(listId);
      if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) {
        return;
      }
      syncPosition();
    };
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, unclipped, listId]);

  useEffect(() => {
    if (activeId) {
      document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
    }
  }, [activeId]);

  const showOptions = (
    index = Math.max(0, selectedIndex),
    fromKeyboard = false,
  ) => {
    if (unclipped && root.current) {
      const next = measureMenuPosition(root.current);
      setMenuPos(next);
      setDropUp(next.dropUp);
    } else {
      const rect = root.current?.getBoundingClientRect();
      if (rect)
        setDropUp(window.innerHeight - rect.bottom < 220 && rect.top > 220);
    }
    setHighlight(index);
    setKeyboardFocus(fromKeyboard);
    setOpen(true);
    search.current = { text: "", at: 0 };
  };

  const choose = (option: SelectOption) => {
    close();
    if (option.value !== value) onChange(option.value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const { key } = event;
    if (key === "Tab") close();
    if (open && key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (!open) showOptions(undefined, true);
      else if (highlighted) choose(highlighted);
      else close();
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
        showOptions(
          selectedIndex < 0 && key === "ArrowUp" ? last : undefined,
          true,
        );
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
      if (open) {
        setKeyboardFocus(true);
        setHighlight(index);
      } else {
        showOptions(index, true);
      }
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
        if (open) {
          setKeyboardFocus(true);
          setHighlight(index);
        } else {
          showOptions(index, true);
        }
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
        style={
          unclipped && focused && keyboardFocus
            ? { outline: "1px solid var(--accent)", outlineOffset: "-1px" }
            : undefined
        }
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      >
        <span>{option.label}</span>
        {selected && <Check size={13} aria-hidden="true" />}
      </button>
    );
  };

  const menuStyle: CSSProperties | undefined =
    unclipped && menuPos
      ? {
          position: "fixed",
          left: menuPos.left,
          right: "auto",
          width: menuPos.width,
          maxHeight: menuPos.maxHeight,
          zIndex: 120,
          ...(menuPos.dropUp
            ? { top: "auto", bottom: menuPos.bottom }
            : { top: menuPos.top, bottom: "auto" }),
        }
      : undefined;

  const menu = open ? (
    <ScrollArea
      id={listId}
      axis="y"
      className="ui-select-menu"
      style={menuStyle}
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
  ) : null;

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
        onClick={() => (open ? close() : showOptions())}
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
      {menu &&
        (unclipped && typeof document !== "undefined"
          ? createPortal(menu, document.body)
          : menu)}
    </div>
  );
}
