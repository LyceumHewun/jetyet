type DirtyState = { hasInteracted: boolean; hasBlurred: boolean };

function spokenText(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  copy.querySelectorAll('[role="img"][aria-label]').forEach((n) => {
    n.replaceWith(`${n.getAttribute("aria-label")}: `);
  });
  return (copy.textContent || "").replace(/\s+/g, " ").trim();
}

function linkError(el: HTMLElement, shown: boolean) {
  const errorId = el.dataset.error;
  if (!errorId) return;
  const ids = (el.getAttribute("aria-describedby") || "")
    .split(/\s+/)
    .filter((id) => id && id !== errorId);
  if (shown) ids.push(errorId);
  if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
  else el.removeAttribute("aria-describedby");
}

export function installAccessibleValidation(): () => void {
  const announcer = document.createElement("div");
  announcer.setAttribute("aria-live", "polite");
  announcer.className = "visually-hidden";
  document.body.append(announcer);

  const supportsUserInvalid =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("selector(:user-invalid)");

  const dirtyState = new WeakMap<Element, DirtyState>();
  const flagged = new WeakSet<Element>();
  const announced = new WeakSet<Element>();
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  let announcedField: Element | null = null;

  const announceError = (el: HTMLElement) => {
    const errorId = el.dataset.error;
    if (!errorId) return;
    const errorEl = document.getElementById(errorId);
    if (!errorEl) return;
    const labelEl = (el as HTMLInputElement).labels?.[0];
    const labelPrefix = labelEl ? `${spokenText(labelEl)}: ` : "";
    clearTimeout(announceTimer);
    announcer.textContent = "";
    announcedField = el;
    announceTimer = setTimeout(() => {
      announcer.textContent = labelPrefix + spokenText(errorEl);
    }, 500);
  };

  const isFieldInvalid = (el: HTMLElement): boolean => {
    if (supportsUserInvalid) {
      return el.matches(":user-invalid");
    }
    return el.classList.contains("user-invalid-fallback");
  };

  const syncAria = (el: EventTarget | null, announce = false) => {
    if (!(el instanceof HTMLElement)) return;
    if (!el.matches("input, select, textarea")) return;
    const invalid = isFieldInvalid(el);
    if (invalid) {
      if (announce && !announced.has(el)) {
        announceError(el);
        announced.add(el);
      }
      el.setAttribute("aria-invalid", "true");
      linkError(el, true);
      flagged.add(el);
    } else if (flagged.has(el) || el.getAttribute("aria-invalid") !== "true") {
      el.setAttribute("aria-invalid", "false");
      linkError(el, false);
      flagged.delete(el);
      announced.delete(el);
      if (announcedField === el) {
        clearTimeout(announceTimer);
        announcer.textContent = "";
      }
    }
  };

  const updateFallback = (
    el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  ) => {
    const valid = el.validity.valid;
    el.classList.toggle("user-invalid-fallback", !valid);
    el.classList.toggle("user-valid-fallback", valid);
  };

  const initControls = (root: ParentNode) => {
    root.querySelectorAll("input, select, textarea").forEach((el) => {
      if (!el.hasAttribute("aria-invalid")) {
        el.setAttribute("aria-invalid", "false");
      }
    });
  };

  initControls(document);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement) {
          if (node.matches("input, select, textarea")) {
            if (!node.hasAttribute("aria-invalid")) {
              node.setAttribute("aria-invalid", "false");
            }
          } else {
            initControls(node);
          }
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const onBlur = (e: FocusEvent) => {
    const t = e.target;
    if (
      !supportsUserInvalid &&
      (t instanceof HTMLInputElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLTextAreaElement)
    ) {
      const state = dirtyState.get(t) || {
        hasInteracted: false,
        hasBlurred: false,
      };
      state.hasBlurred = true;
      dirtyState.set(t, state);
      if (state.hasInteracted) updateFallback(t);
    }
    syncAria(t, true);
  };

  const onInput = (e: Event) => {
    const t = e.target;
    if (
      !supportsUserInvalid &&
      (t instanceof HTMLInputElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLTextAreaElement)
    ) {
      const state = dirtyState.get(t) || {
        hasInteracted: false,
        hasBlurred: false,
      };
      state.hasInteracted = true;
      dirtyState.set(t, state);
      if (state.hasBlurred) updateFallback(t);
    }
    if (t instanceof HTMLElement && t.hasAttribute("aria-invalid")) {
      syncAria(t, false);
    }
  };

  const onChange = (e: Event) => {
    const t = e.target;
    if (
      !supportsUserInvalid &&
      (t instanceof HTMLInputElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLTextAreaElement)
    ) {
      const state = dirtyState.get(t) || {
        hasInteracted: false,
        hasBlurred: false,
      };
      state.hasInteracted = true;
      dirtyState.set(t, state);
      if (state.hasBlurred) updateFallback(t);
    }
    syncAria(t, true);
  };

  const onInvalid = (e: Event) => {
    const t = e.target;
    if (
      !supportsUserInvalid &&
      (t instanceof HTMLInputElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLTextAreaElement)
    ) {
      dirtyState.set(t, { hasInteracted: true, hasBlurred: true });
      updateFallback(t);
    }
    if (t instanceof Element) announced.add(t);
    syncAria(t, false);
  };

  const onReset = (e: Event) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    setTimeout(() => {
      for (const control of Array.from(form.elements)) {
        dirtyState.delete(control);
        control.classList.remove(
          "user-invalid-fallback",
          "user-valid-fallback",
        );
        syncAria(control, false);
      }
    });
  };

  document.addEventListener("blur", onBlur, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("invalid", onInvalid, true);
  document.addEventListener("reset", onReset, true);

  return () => {
    clearTimeout(announceTimer);
    observer.disconnect();
    document.removeEventListener("blur", onBlur, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("invalid", onInvalid, true);
    document.removeEventListener("reset", onReset, true);
    announcer.remove();
  };
}
