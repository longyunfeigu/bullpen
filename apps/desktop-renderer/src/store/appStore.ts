import { create } from 'zustand';
import type {
  AppInfoDto,
  LayoutState,
  Settings,
  SideBarView,
  BottomTab,
} from '@pi-ide/ipc-contracts';
import { LayoutStateSchema } from '@pi-ide/ipc-contracts';
import { newId } from '@pi-ide/foundation';
import { onEvent, rpc, rpcResult } from '../bridge.js';

export type OverlayKind = 'none' | 'settings' | 'diagnostics' | 'about';

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success' | 'warning';
  message: string;
}

interface AppStore {
  ready: boolean;
  appInfo: AppInfoDto | null;
  settings: Settings | null;
  settingsIssues: string[];
  layout: LayoutState;
  paletteOpen: boolean;
  overlay: OverlayKind;
  toasts: Toast[];

  init(): Promise<void>;
  setLayout(patch: Partial<LayoutState>): void;
  toggleSidebar(): void;
  toggleAgentPanel(): void;
  toggleBottomPanel(): void;
  showSideBarView(view: SideBarView): void;
  showBottomTab(tab: BottomTab): void;
  setPaletteOpen(open: boolean): void;
  setOverlay(overlay: OverlayKind): void;
  updateSettings(scope: 'global' | 'workspace', patch: Record<string, unknown>): Promise<void>;
  refreshSettings(): Promise<void>;
  pushToast(kind: Toast['kind'], message: string): void;
  dismissToast(id: string): void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistLayout(layout: LayoutState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void rpcResult('layout.save', { layout });
  }, 400);
}

function applyThemeAttribute(settings: Settings | null): void {
  const pref = settings?.general.theme ?? 'system';
  const dark =
    pref === 'dark' ||
    (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const scale = settings?.general.uiScale ?? 1;
  document.documentElement.style.fontSize = `${Math.round(13 * scale)}px`;
}

export const useAppStore = create<AppStore>((set, get) => ({
  ready: false,
  appInfo: null,
  settings: null,
  settingsIssues: [],
  layout: LayoutStateSchema.parse({}),
  paletteOpen: false,
  overlay: 'none',
  toasts: [],

  async init() {
    const [info, settingsState, layoutRes] = await Promise.all([
      rpcResult('app.getInfo', {}),
      rpcResult('settings.get', {}),
      rpcResult('layout.get', {}),
    ]);
    if (info.ok) set({ appInfo: info.data });
    if (settingsState.ok) {
      set({ settings: settingsState.data.effective, settingsIssues: settingsState.data.issues });
      applyThemeAttribute(settingsState.data.effective);
    }
    if (layoutRes.ok && layoutRes.data.layout) set({ layout: layoutRes.data.layout });
    set({ ready: true });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      applyThemeAttribute(get().settings);
    });
    onEvent('settings.changed', () => {
      void get().refreshSettings();
    });
  },

  setLayout(patch) {
    const layout = { ...get().layout, ...patch };
    set({ layout });
    persistLayout(layout);
  },

  toggleSidebar() {
    get().setLayout({ sideBarVisible: !get().layout.sideBarVisible });
  },
  toggleAgentPanel() {
    get().setLayout({ agentPanelVisible: !get().layout.agentPanelVisible });
  },
  toggleBottomPanel() {
    get().setLayout({ bottomPanelVisible: !get().layout.bottomPanelVisible });
  },
  showSideBarView(view) {
    get().setLayout({ sideBarView: view, sideBarVisible: true });
  },
  showBottomTab(tab) {
    get().setLayout({ bottomTab: tab, bottomPanelVisible: true });
  },
  setPaletteOpen(open) {
    set({ paletteOpen: open });
  },
  setOverlay(overlay) {
    set({ overlay });
  },

  async updateSettings(scope, patch) {
    const result = await rpcResult('settings.update', { scope, patch });
    if (result.ok) {
      set({ settings: result.data.effective, settingsIssues: result.data.issues });
      applyThemeAttribute(result.data.effective);
    } else {
      get().pushToast('error', `${result.error.userMessage} (${result.error.code})`);
    }
  },

  async refreshSettings() {
    const result = await rpcResult('settings.get', {});
    if (result.ok) {
      set({ settings: result.data.effective, settingsIssues: result.data.issues });
      applyThemeAttribute(result.data.effective);
    }
  },

  pushToast(kind, message) {
    const toast: Toast = { id: newId('toast'), kind, message };
    set({ toasts: [...get().toasts, toast] });
    setTimeout(() => get().dismissToast(toast.id), kind === 'error' ? 8000 : 4000);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
}));

export async function reportClientError(
  code: string,
  message: string,
  stack?: string,
): Promise<void> {
  try {
    await rpc('app.reportClientError', { code, message, ...(stack ? { stack } : {}) });
  } catch {
    // never loop on error reporting
  }
}
