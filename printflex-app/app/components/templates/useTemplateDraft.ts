import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useBlocker } from "react-router";
import { useNativeEvent } from "../orders/useNativeEvent";

/**
 * Tracks whether the settings form differs from what was loaded, warns
 * before the merchant leaves with unsaved edits, and debounces preview
 * requests. The form is the source of truth; this hook only watches it.
 */
export function useTemplateDraft(args: {
  formRef: RefObject<HTMLFormElement | null>;
  /** Changes whenever the loaded template or its version changes. */
  loadedKey: string;
  onPreview: () => void;
  debounceMs?: number;
}) {
  const { formRef, loadedKey, onPreview, debounceMs = 350 } = args;
  const [dirty, setDirty] = useState(false);
  const baseline = useRef<string>("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const serialize = useCallback((): string => {
    if (!formRef.current) return "";
    const pairs: string[] = [];
    for (const [key, value] of new FormData(formRef.current)) {
      if (typeof value === "string") pairs.push(`${key}=${value}`);
    }
    return pairs.sort().join("&");
  }, [formRef]);

  // A fresh load (or a completed save) resets the baseline. Polaris fields
  // register their form values a tick after mount, hence the timeout.
  useEffect(() => {
    const handle = setTimeout(() => {
      baseline.current = serialize();
      setDirty(false);
    }, 50);
    return () => clearTimeout(handle);
  }, [loadedKey, serialize]);

  const recheck = useCallback(() => {
    setDirty(serialize() !== baseline.current);
  }, [serialize]);

  const schedulePreview = useCallback(() => {
    recheck();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(onPreview, debounceMs);
  }, [debounceMs, onPreview, recheck]);

  useNativeEvent(formRef, "change", schedulePreview);
  useNativeEvent(formRef, "input", schedulePreview);

  // Browser-level warning for reloads and tab closes.
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // In-app navigation (another template, another page) is held until confirmed.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search);

  /** Call after a programmatic change (logo, swatch) that fires no form event. */
  const markChanged = useCallback(() => setTimeout(schedulePreview, 0), [schedulePreview]);

  return { dirty, blocker, markChanged, recheck };
}
