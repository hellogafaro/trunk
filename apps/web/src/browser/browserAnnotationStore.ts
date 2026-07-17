import { create } from "zustand";

interface BrowserAnnotationStoreState {
  readonly activeByTabId: Readonly<Record<string, true>>;
  readonly start: (tabId: string) => void;
  readonly cancel: (tabId: string) => void;
  readonly toggle: (tabId: string) => void;
}

export const useBrowserAnnotationStore = create<BrowserAnnotationStoreState>()((set) => ({
  activeByTabId: {},
  start: (tabId) =>
    set((state) =>
      state.activeByTabId[tabId]
        ? state
        : { activeByTabId: { ...state.activeByTabId, [tabId]: true } },
    ),
  cancel: (tabId) =>
    set((state) => {
      if (!state.activeByTabId[tabId]) return state;
      const next = { ...state.activeByTabId };
      delete next[tabId];
      return { activeByTabId: next };
    }),
  toggle: (tabId) =>
    set((state) => {
      const next = { ...state.activeByTabId };
      if (next[tabId]) delete next[tabId];
      else next[tabId] = true;
      return { activeByTabId: next };
    }),
}));

export const startBrowserAnnotation = (tabId: string): void =>
  useBrowserAnnotationStore.getState().start(tabId);

export const cancelBrowserAnnotation = (tabId: string): void =>
  useBrowserAnnotationStore.getState().cancel(tabId);

export const toggleBrowserAnnotation = (tabId: string): void =>
  useBrowserAnnotationStore.getState().toggle(tabId);
