import { useEffect, type RefObject } from "react";

/**
 * React 18 does not forward event props to custom elements, so Polaris web
 * component events (change, nextpage, ...) are attached natively.
 */
export function useNativeEvent<E extends Event = Event>(
  ref: RefObject<HTMLElement | null>,
  type: string,
  handler: (event: E) => void,
  options?: AddEventListenerOptions,
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = (event: Event) => handler(event as E);
    element.addEventListener(type, listener, options);
    return () => element.removeEventListener(type, listener, options);
  }, [ref, type, handler, options]);
}
