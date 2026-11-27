import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ScrollArea } from "./Scrollbars";

function VirtualRow({
  itemKey,
  offset,
  onMeasure,
  children,
}: {
  itemKey: string;
  offset: number;
  onMeasure: (key: string, height: number) => void;
  children: ReactNode;
}) {
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) onMeasure(itemKey, Math.ceil(h));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [itemKey, onMeasure]);

  return (
    <div
      ref={rowRef}
      className="virtual-row"
      style={{ transform: `translate3d(0, ${offset}px, 0)` }}
    >
      {children}
    </div>
  );
}

/**
 * Variable-height virtualized infinite-scroll list rendered inside OverlayScrollbars.
 */
export function VirtualList<T>({
  items,
  getKey,
  estimateHeight = 64,
  overscan = 6,
  hasMore,
  loadingMore,
  onLoadMore,
  resetKey,
  className = "",
  footer,
  renderItem,
}: {
  items: T[];
  getKey: (item: T) => string;
  estimateHeight?: number;
  overscan?: number;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  resetKey: string;
  className?: string;
  footer?: ReactNode;
  renderItem: (item: T, index: number) => ReactNode;
}) {
  const viewportRef = useRef<HTMLElement | null>(null);
  const heightsRef = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number | null>(null);
  const [measureVersion, setMeasureVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);

  const onMeasure = useCallback((key: string, height: number) => {
    const prev = heightsRef.current.get(key);
    if (prev !== undefined && Math.abs(prev - height) < 1) return;
    heightsRef.current.set(key, height);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        setMeasureVersion((v) => v + 1);
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    heightsRef.current.clear();
    if (viewportRef.current) {
      viewportRef.current.scrollTop = 0;
    }
    setScrollTop(0);
    setMeasureVersion((v) => v + 1);
  }, [resetKey]);

  const offsets = useMemo(() => {
    const arr = new Array<number>(items.length + 1);
    arr[0] = 0;
    for (let i = 0; i < items.length; i++) {
      const h = heightsRef.current.get(getKey(items[i])) ?? estimateHeight;
      arr[i + 1] = arr[i] + h;
    }
    return arr;
  }, [items, getKey, estimateHeight, measureVersion]);

  const totalHeight = offsets[items.length] ?? 0;

  const { startIdx, endIdx } = useMemo(() => {
    if (items.length === 0) return { startIdx: 0, endIdx: -1 };
    let lo = 0;
    let hi = items.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    const start = Math.max(0, lo - overscan);

    const viewBottom = scrollTop + viewportHeight;
    let endLo = lo;
    let endHi = items.length - 1;
    while (endLo < endHi) {
      const mid = (endLo + endHi) >> 1;
      if (offsets[mid] < viewBottom) endLo = mid + 1;
      else endHi = mid;
    }
    const end = Math.min(items.length - 1, endLo + overscan);
    return { startIdx: start, endIdx: end };
  }, [items.length, offsets, scrollTop, viewportHeight, overscan]);

  useEffect(() => {
    if (!hasMore || loadingMore || items.length === 0) return;
    if (
      scrollTop + viewportHeight >= totalHeight - 240 ||
      totalHeight <= viewportHeight + 120
    ) {
      onLoadMore();
    }
  }, [
    hasMore,
    loadingMore,
    items.length,
    scrollTop,
    viewportHeight,
    totalHeight,
    onLoadMore,
  ]);

  const scrollEvents = useMemo(
    () => ({
      initialized: (instance: any) => {
        const vp = instance.elements().viewport as HTMLElement | undefined;
        if (!vp) return;
        viewportRef.current = vp;
        setViewportHeight(vp.clientHeight || 480);
        setScrollTop(vp.scrollTop);
      },
      updated: (instance: any) => {
        const vp = instance.elements().viewport as HTMLElement | undefined;
        if (!vp) return;
        viewportRef.current = vp;
        if (vp.clientHeight > 0) setViewportHeight(vp.clientHeight);
      },
      scroll: (instance: any) => {
        const vp = instance.elements().viewport as HTMLElement | undefined;
        if (!vp) return;
        setScrollTop(vp.scrollTop);
        if (vp.clientHeight > 0) setViewportHeight(vp.clientHeight);
      },
    }),
    [],
  );

  const visibleIndices: number[] = [];
  for (let i = startIdx; i <= endIdx; i++) visibleIndices.push(i);

  return (
    <ScrollArea
      axis="y"
      className={["virtual-scroll-area", className].filter(Boolean).join(" ")}
      events={scrollEvents}
    >
      <div className="virtual-canvas" style={{ height: totalHeight }}>
        {visibleIndices.map((idx) => {
          const item = items[idx];
          const key = getKey(item);
          return (
            <VirtualRow
              key={key}
              itemKey={key}
              offset={offsets[idx]}
              onMeasure={onMeasure}
            >
              {renderItem(item, idx)}
            </VirtualRow>
          );
        })}
      </div>
      {footer}
    </ScrollArea>
  );
}
