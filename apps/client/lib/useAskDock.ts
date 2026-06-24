import { useCallback, useSyncExternalStore } from "react";

// --- shared "Ask the brain" dock open-state store --------------------------
// Module-level (mirrors useProject) so the Topbar command pill, the global
// ⌘K listener, and the <AskDock/> all read/write ONE open state. No persistence.
let open = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function setOpenState(v: boolean) {
  if (open === v) return;
  open = v;
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const getSnapshot = () => open;
const getServerSnapshot = () => false;

export interface UseAskDockResult {
  open: boolean;
  setOpen: (v: boolean) => void;
  toggle: () => void;
}

export function useAskDock(): UseAskDockResult {
  const isOpen = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);
  const toggle = useCallback(() => setOpenState(!open), []);
  return { open: isOpen, setOpen, toggle };
}
