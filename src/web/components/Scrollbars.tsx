import "@fontsource-variable/jetbrains-mono";
import "overlayscrollbars/styles/overlayscrollbars.css";
import {
  ClickScrollPlugin,
  OverlayScrollbars,
  type EventListeners,
  type PartialOptions,
} from "overlayscrollbars";
import {
  OverlayScrollbarsComponent,
  useOverlayScrollbars,
  type OverlayScrollbarsComponentRef,
} from "overlayscrollbars-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type CSSProperties,
  type ElementType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

let pluginRegistered = false;
function ensurePlugin() {
  if (!pluginRegistered) {
    OverlayScrollbars.plugin(ClickScrollPlugin);
    pluginRegistered = true;
  }
}

export const OVERLAY_SCROLLBAR_THEME = "os-theme-jetyet";

export const OVERLAY_SCROLLBAR_OPTIONS: PartialOptions = {
  paddingAbsolute: false,
  showNativeOverlaidScrollbars: false,
  overflow: {
    x: "scroll",
    y: "scroll",
  },
  scrollbars: {
    theme: OVERLAY_SCROLLBAR_THEME,
    visibility: "auto",
    autoHide: "scroll",
    autoHideDelay: 850,
    autoHideSuspend: false,
    dragScroll: true,
    clickScroll: true,
    pointers: ["mouse", "touch", "pen"],
  },
};

function mergeScrollbarOptions(
  base: PartialOptions,
  override?: PartialOptions,
): PartialOptions {
  if (!override) return base;
  return {
    ...base,
    ...override,
    update: {
      ...base.update,
      ...override.update,
    },
    overflow: {
      ...base.overflow,
      ...override.overflow,
    },
    scrollbars: {
      ...base.scrollbars,
      ...override.scrollbars,
    },
  };
}

type OverflowAxisBehavior = NonNullable<
  NonNullable<PartialOptions["overflow"]>["y"]
>;

let docRefCount = 0;
let docInstance: OverlayScrollbars | null = null;
let docLockCount = 0;
let priorDocOverflowY: OverflowAxisBehavior | null = null;

function getConfiguredOverflowY(options?: PartialOptions): OverflowAxisBehavior {
  return options?.overflow?.y ?? OVERLAY_SCROLLBAR_OPTIONS.overflow?.y ?? "scroll";
}

function withLockedOverflowY(options: PartialOptions): PartialOptions {
  return {
    ...options,
    overflow: {
      ...options.overflow,
      y: "hidden",
    },
  };
}

/**
 * Initializes the document-level non-gutter overlay scrollbar on `document.body`.
 * Safe to call multiple times; returns a cleanup callback for React effects.
 */
export function initDocumentScrollbars(options?: PartialOptions): () => void {
  if (typeof document === "undefined") return () => {};
  ensurePlugin();

  document.documentElement.setAttribute("data-overlayscrollbars-initialize", "");
  document.body.setAttribute("data-overlayscrollbars-initialize", "");

  docRefCount += 1;
  const merged = mergeScrollbarOptions(OVERLAY_SCROLLBAR_OPTIONS, options);

  if (!OverlayScrollbars.valid(docInstance)) {
    if (docLockCount > 0) {
      priorDocOverflowY = getConfiguredOverflowY(merged);
    }
    docInstance = OverlayScrollbars(
      {
        target: document.body,
        cancel: {
          nativeScrollbarsOverlaid: false,
          body: false,
        },
      },
      docLockCount > 0 ? withLockedOverflowY(merged) : merged,
    );
  } else if (options) {
    if (docLockCount > 0) {
      priorDocOverflowY = getConfiguredOverflowY(merged);
      docInstance.options(withLockedOverflowY(merged), true);
    } else {
      docInstance.options(merged, true);
    }
  }

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    docRefCount = Math.max(0, docRefCount - 1);
    if (docRefCount === 0) {
      if (OverlayScrollbars.valid(docInstance)) {
        docInstance.destroy();
      }
      docInstance = null;
      priorDocOverflowY = null;
    }
  };
}

/**
 * Locks vertical document scrolling on the document OverlayScrollbars instance
 * while at least one lock is active, preserving configured horizontal overflow
 * and restoring prior vertical overflow on the final cleanup.
 */
export function lockDocumentScroll(): () => void {
  if (typeof document === "undefined") return () => {};

  docLockCount += 1;
  if (docLockCount === 1 && OverlayScrollbars.valid(docInstance)) {
    const currentOverflow = docInstance.options().overflow;
    priorDocOverflowY = currentOverflow.y;
    docInstance.options({
      overflow: {
        x: currentOverflow.x,
        y: "hidden",
      },
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    docLockCount = Math.max(0, docLockCount - 1);
    if (docLockCount === 0) {
      const restoreY = priorDocOverflowY;
      priorDocOverflowY = null;
      if (restoreY !== null && OverlayScrollbars.valid(docInstance)) {
        const currentOverflow = docInstance.options().overflow;
        docInstance.options({
          overflow: {
            x: currentOverflow.x,
            y: restoreY,
          },
        });
      }
    }
  };
}

export type ScrollAxis = "both" | "x" | "y";

export type ScrollAreaProps<T extends ElementType = "div"> = Omit<
  ComponentPropsWithoutRef<T>,
  "as" | "options" | "events" | "defer" | "className" | "children"
> & {
  as?: T;
  axis?: ScrollAxis;
  options?: PartialOptions;
  events?: EventListeners | false | null;
  defer?: boolean | IdleRequestOptions;
  className?: string;
  children?: ReactNode;
};

/**
 * React wrapper applying non-gutter OverlayScrollbars on one or both axes.
 */
export function ScrollArea<T extends ElementType = "div">({
  as,
  axis = "both",
  options,
  defer = false,
  className = "",
  children,
  ...rest
}: ScrollAreaProps<T>) {
  ensurePlugin();

  const mergedOptions = useMemo<PartialOptions>(() => {
    const axisOverflow: PartialOptions["overflow"] = {
      x: axis === "y" ? "hidden" : "scroll",
      y: axis === "x" ? "hidden" : "scroll",
    };
    return mergeScrollbarOptions(
      mergeScrollbarOptions(OVERLAY_SCROLLBAR_OPTIONS, {
        overflow: axisOverflow,
      }),
      options,
    );
  }, [axis, options]);

  const Component = (as ?? "div") as ElementType;
  const OsComponent = OverlayScrollbarsComponent as ComponentType<
    Record<string, unknown>
  >;

  return (
    <OsComponent
      element={Component}
      options={mergedOptions}
      defer={defer}
      className={["os-scroll-area", className].filter(Boolean).join(" ")}
      {...(rest as Record<string, unknown>)}
    >
      {children}
    </OsComponent>
  );
}

type AxisMetrics = {
  usable: boolean;
  viewportPercent: number;
  scrollPercent: number;
  maxScroll: number;
};

const EMPTY_AXIS: AxisMetrics = {
  usable: false,
  viewportPercent: 1,
  scrollPercent: 0,
  maxScroll: 0,
};

function computeAxisMetrics(
  clientSize: number,
  scrollSize: number,
  scrollPos: number,
): AxisMetrics {
  const maxScroll = Math.max(0, scrollSize - clientSize);
  if (maxScroll <= 1 || scrollSize <= 0) {
    return EMPTY_AXIS;
  }
  return {
    usable: true,
    viewportPercent: Math.min(1, Math.max(0.05, clientSize / scrollSize)),
    scrollPercent: Math.min(1, Math.max(0, scrollPos / maxScroll)),
    maxScroll,
  };
}

/**
 * Native `<textarea>` wrapped with synchronized, draggable, non-gutter overlay scrollbars
 * on both horizontal and vertical axes.
 */
export const ScrollTextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function ScrollTextArea(
  { className = "", style, onScroll, onInput, ...rest },
  forwardedRef,
) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trackXRef = useRef<HTMLDivElement | null>(null);
  const trackYRef = useRef<HTMLDivElement | null>(null);
  const handleXRef = useRef<HTMLDivElement | null>(null);
  const handleYRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const [metrics, setMetrics] = useState<{ x: AxisMetrics; y: AxisMetrics }>({
    x: EMPTY_AXIS,
    y: EMPTY_AXIS,
  });
  const [scrolling, setScrolling] = useState(false);
  const [draggingAxis, setDraggingAxis] = useState<"x" | "y" | null>(null);

  const dragStateRef = useRef<{
    axis: "x" | "y";
    pointerId: number;
    startPointer: number;
    startScroll: number;
    scrollableTrack: number;
    maxScroll: number;
  } | null>(null);

  useImperativeHandle(
    forwardedRef,
    () => textareaRef.current as HTMLTextAreaElement,
    [],
  );

  const syncMetrics = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const nextX = computeAxisMetrics(
      ta.clientWidth,
      ta.scrollWidth,
      ta.scrollLeft,
    );
    const nextY = computeAxisMetrics(
      ta.clientHeight,
      ta.scrollHeight,
      ta.scrollTop,
    );
    setMetrics((prev) => {
      if (
        prev.x.usable === nextX.usable &&
        Math.abs(prev.x.viewportPercent - nextX.viewportPercent) < 0.001 &&
        Math.abs(prev.x.scrollPercent - nextX.scrollPercent) < 0.001 &&
        prev.x.maxScroll === nextX.maxScroll &&
        prev.y.usable === nextY.usable &&
        Math.abs(prev.y.viewportPercent - nextY.viewportPercent) < 0.001 &&
        Math.abs(prev.y.scrollPercent - nextY.scrollPercent) < 0.001 &&
        prev.y.maxScroll === nextY.maxScroll
      ) {
        return prev;
      }
      return { x: nextX, y: nextY };
    });
  }, []);

  const scheduleSync = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      syncMetrics();
    });
  }, [syncMetrics]);

  const bumpScrolling = useCallback(() => {
    setScrolling(true);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setScrolling(false);
      hideTimerRef.current = null;
    }, 850);
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    syncMetrics();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => scheduleSync())
        : null;
    observer?.observe(ta);
    return () => {
      observer?.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, [syncMetrics, scheduleSync]);

  useEffect(() => {
    scheduleSync();
  }, [rest.value, rest.defaultValue, rest.rows, rest.cols, scheduleSync]);

  const startHandleDrag = (
    axis: "x" | "y",
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0) return;
    const ta = textareaRef.current;
    const track = axis === "y" ? trackYRef.current : trackXRef.current;
    const handle = axis === "y" ? handleYRef.current : handleXRef.current;
    if (!ta || !track || !handle) return;

    const axisMetric = axis === "y" ? metrics.y : metrics.x;
    if (!axisMetric.usable) return;

    e.preventDefault();
    e.stopPropagation();

    const trackRect = track.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const trackSize = axis === "y" ? trackRect.height : trackRect.width;
    const handleSize = axis === "y" ? handleRect.height : handleRect.width;

    dragStateRef.current = {
      axis,
      pointerId: e.pointerId,
      startPointer: axis === "y" ? e.clientY : e.clientX,
      startScroll: axis === "y" ? ta.scrollTop : ta.scrollLeft,
      scrollableTrack: Math.max(1, trackSize - handleSize),
      maxScroll: axisMetric.maxScroll,
    };
    setDraggingAxis(axis);
    bumpScrolling();
    handle.setPointerCapture(e.pointerId);
  };

  const moveHandleDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    const ta = textareaRef.current;
    if (!drag || !ta || drag.pointerId !== e.pointerId) return;

    const currentPointer = drag.axis === "y" ? e.clientY : e.clientX;
    const deltaPointer = currentPointer - drag.startPointer;
    const nextScroll =
      drag.startScroll +
      (deltaPointer / drag.scrollableTrack) * drag.maxScroll;

    if (drag.axis === "y") {
      ta.scrollTop = Math.min(drag.maxScroll, Math.max(0, nextScroll));
    } else {
      ta.scrollLeft = Math.min(drag.maxScroll, Math.max(0, nextScroll));
    }
    syncMetrics();
    bumpScrolling();
  };

  const endHandleDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    setDraggingAxis(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    bumpScrolling();
  };

  const handleTrackPointerDown = (
    axis: "x" | "y",
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    const ta = textareaRef.current;
    const track = e.currentTarget;
    const handle = axis === "y" ? handleYRef.current : handleXRef.current;
    const axisMetric = axis === "y" ? metrics.y : metrics.x;
    if (!ta || !handle || !axisMetric.usable) return;

    e.preventDefault();
    const trackRect = track.getBoundingClientRect();
    const handleRect = handle.getBoundingClientRect();
    const trackSize = axis === "y" ? trackRect.height : trackRect.width;
    const handleSize = axis === "y" ? handleRect.height : handleRect.width;
    const offset =
      (axis === "y" ? e.clientY - trackRect.top : e.clientX - trackRect.left) -
      handleSize / 2;
    const ratio = Math.min(
      1,
      Math.max(0, offset / Math.max(1, trackSize - handleSize)),
    );
    const targetScroll = ratio * axisMetric.maxScroll;

    if (axis === "y") {
      ta.scrollTop = targetScroll;
    } else {
      ta.scrollLeft = targetScroll;
    }
    syncMetrics();
    bumpScrolling();
  };

  const bothUsable = metrics.x.usable && metrics.y.usable;
  const visibleClass = scrolling || draggingAxis ? " os-scrollbar-visible" : "";

  const xVars = {
    "--os-viewport-percent": metrics.x.viewportPercent,
    "--os-scroll-percent": metrics.x.scrollPercent,
  } as CSSProperties;

  const yVars = {
    "--os-viewport-percent": metrics.y.viewportPercent,
    "--os-scroll-percent": metrics.y.scrollPercent,
  } as CSSProperties;

  return (
    <div
      className={[
        "ui-textarea-scroll",
        draggingAxis ? "is-dragging" : "",
        scrolling ? "is-scrolling" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
    >
      <textarea
        ref={textareaRef}
        className="ui-textarea"
        onScroll={(e) => {
          syncMetrics();
          bumpScrolling();
          onScroll?.(e);
        }}
        onInput={(e) => {
          scheduleSync();
          onInput?.(e);
        }}
        {...rest}
      />
      <div
        aria-hidden="true"
        style={xVars}
        className={[
          "os-scrollbar",
          "os-scrollbar-horizontal",
          OVERLAY_SCROLLBAR_THEME,
          "os-scrollbar-auto-hide",
          !scrolling && draggingAxis !== "x" ? "os-scrollbar-auto-hide-hidden" : "",
          "os-scrollbar-handle-interactive",
          "os-scrollbar-track-interactive",
          !bothUsable ? "os-scrollbar-cornerless" : "",
          !metrics.x.usable ? "os-scrollbar-unusable" : "",
          draggingAxis === "x" ? "os-scrollbar-interaction" : "",
          visibleClass,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          ref={trackXRef}
          className="os-scrollbar-track"
          onPointerDown={(e) => handleTrackPointerDown("x", e)}
        >
          <div
            ref={handleXRef}
            className="os-scrollbar-handle"
            onPointerDown={(e) => startHandleDrag("x", e)}
            onPointerMove={moveHandleDrag}
            onPointerUp={endHandleDrag}
            onPointerCancel={endHandleDrag}
          />
        </div>
      </div>
      <div
        aria-hidden="true"
        style={yVars}
        className={[
          "os-scrollbar",
          "os-scrollbar-vertical",
          OVERLAY_SCROLLBAR_THEME,
          "os-scrollbar-auto-hide",
          !scrolling && draggingAxis !== "y" ? "os-scrollbar-auto-hide-hidden" : "",
          "os-scrollbar-handle-interactive",
          "os-scrollbar-track-interactive",
          !bothUsable ? "os-scrollbar-cornerless" : "",
          !metrics.y.usable ? "os-scrollbar-unusable" : "",
          draggingAxis === "y" ? "os-scrollbar-interaction" : "",
          visibleClass,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div
          ref={trackYRef}
          className="os-scrollbar-track"
          onPointerDown={(e) => handleTrackPointerDown("y", e)}
        >
          <div
            ref={handleYRef}
            className="os-scrollbar-handle"
            onPointerDown={(e) => startHandleDrag("y", e)}
            onPointerMove={moveHandleDrag}
            onPointerUp={endHandleDrag}
            onPointerCancel={endHandleDrag}
          />
        </div>
      </div>
    </div>
  );
});

export { useOverlayScrollbars, type OverlayScrollbarsComponentRef };
