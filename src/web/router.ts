import { useCallback, useEffect, useState, type MouseEvent } from "react";
import type { Route, Section } from "./types";

const sections = new Set<Section>([
  "overview",
  "vps",
  "nodes",
  "users",
  "templates",
  "operations",
  "alerts",
  "onboard",
]);

export function buildHash(route: Route): string {
  const parts: string[] = [route.section];
  if (route.mode === "archive") {
    parts.push("archive");
    if (route.id) parts.push(encodeURIComponent(route.id));
  } else if (route.mode === "new") {
    parts.push("new");
  } else if (route.id) {
    parts.push(encodeURIComponent(route.id));
  }
  const query = route.sub ? `?sub=${encodeURIComponent(route.sub)}` : "";
  return `#/${parts.join("/")}${query}`;
}

export function parseHash(rawHash: string): Route | null {
  if (!rawHash || rawHash === "#") return { section: "overview" };
  if (!rawHash.startsWith("#/")) return null;

  const withoutPrefix = rawHash.slice(2);
  const [pathPart, queryPart = ""] = withoutPrefix.split("?");
  const segments = pathPart
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });

  const first = (segments[0] || "overview") as Section;
  const section: Section = sections.has(first) ? first : "overview";
  const params = new URLSearchParams(queryPart);
  const sub = params.get("sub") || undefined;

  if (segments[1] === "archive") {
    return { section, mode: "archive", id: segments[2], sub };
  }
  if (segments[1] === "new") {
    return { section, mode: "new", sub };
  }
  return { section, id: segments[1], sub };
}

export function isDetailRoute(route: Route): boolean {
  return Boolean(route.id || route.mode === "new");
}

export function useRouter() {
  const [initialState] = useState(() => {
    const parsed = parseHash(window.location.hash) ?? { section: "overview" };
    const existingDepth = Number(window.history.state?.depth);
    const depth = Number.isFinite(existingDepth) ? existingDepth : 0;
    return {
      route: parsed,
      depth,
      atDeepLinkDetail: depth === 0 && isDetailRoute(parsed),
    };
  });

  const [route, setRoute] = useState<Route>(initialState.route);
  const [depth, setDepth] = useState<number>(initialState.depth);
  const [atDeepLinkDetail, setAtDeepLinkDetail] = useState<boolean>(
    initialState.atDeepLinkDetail,
  );

  useEffect(() => {
    const targetHash = buildHash(initialState.route);
    if (!window.location.hash || window.location.hash === "#") {
      window.history.replaceState(
        { depth: initialState.depth, route: initialState.route },
        "",
        targetHash,
      );
    } else if (window.history.state?.depth === undefined) {
      window.history.replaceState(
        { depth: initialState.depth, route: initialState.route },
        "",
        window.location.hash,
      );
    }
  }, [initialState]);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const nextRoute = parseHash(window.location.hash);
      if (!nextRoute) return;
      const nextDepth = Number(event.state?.depth);
      const resolvedDepth = Number.isFinite(nextDepth) ? nextDepth : 0;
      setRoute(nextRoute);
      setDepth(resolvedDepth);
      setAtDeepLinkDetail(resolvedDepth === 0 && isDetailRoute(nextRoute));
    };

    const onHashChange = () => {
      const nextRoute = parseHash(window.location.hash);
      if (!nextRoute) return;
      setRoute(nextRoute);
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const navigate = useCallback(
    (next: Route, replace = false) => {
      const nextHash = buildHash(next);
      const currentHash = buildHash(route);
      if (nextHash === currentHash && !replace) return;

      if (replace) {
        window.history.replaceState({ depth, route: next }, "", nextHash);
        setRoute(next);
        setAtDeepLinkDetail(depth === 0 && isDetailRoute(next));
        return;
      }

      const nextDepth = depth + 1;
      window.history.pushState({ depth: nextDepth, route: next }, "", nextHash);
      setDepth(nextDepth);
      setRoute(next);
      setAtDeepLinkDetail(false);
    },
    [depth, route],
  );

  const goBackToRoot = useCallback(
    (section: Section) => {
      if (atDeepLinkDetail || depth === 0) {
        // Synthesize root entry instead of leaving the app when opened on a deep link.
        const rootRoute: Route = {
          section,
          mode: route.mode === "archive" ? "archive" : undefined,
        };
        const nextDepth = depth + 1;
        window.history.pushState(
          { depth: nextDepth, route: rootRoute },
          "",
          buildHash(rootRoute),
        );
        setDepth(nextDepth);
        setRoute(rootRoute);
        setAtDeepLinkDetail(false);
        return;
      }
      window.history.back();
    },
    [atDeepLinkDetail, depth, route.mode],
  );

  const linkProps = useCallback(
    (next: Route, replace = false) => ({
      href: buildHash(next),
      onClick: (e: MouseEvent<HTMLAnchorElement>) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
          return;
        }
        e.preventDefault();
        navigate(next, replace);
      },
    }),
    [navigate],
  );

  return { route, depth, navigate, goBackToRoot, linkProps };
}
