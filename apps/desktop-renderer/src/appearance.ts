import { DEFAULT_EDITOR_FONT_FAMILY, type Settings } from '@pi-ide/ipc-contracts';

export type AppearanceSkin = Settings['general']['skin'];
export type EffectiveTheme = 'light' | 'dark';

export const SKIN_LABELS: Record<AppearanceSkin, { name: string; description: string }> = {
  studio: {
    name: 'Studio',
    description: 'Warm gray · ink · original Charter',
  },
  terminal: {
    name: 'Terminal',
    description: 'Phosphor green · charcoal · monospaced',
  },
  archive: {
    name: 'Archive',
    description: 'Cream paper · terracotta · editorial',
  },
  index: {
    name: 'Index',
    description: 'Black · white · signal red',
  },
};

const EDITOR_FONTS: Record<AppearanceSkin, string> = {
  studio: DEFAULT_EDITOR_FONT_FAMILY,
  terminal: "'Berkeley Mono', 'SFMono-Regular', Menlo, Monaco, Consolas, monospace",
  archive: "'Courier Prime', 'American Typewriter', 'SFMono-Regular', Menlo, monospace",
  index: "'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
};

export function resolveEffectiveTheme(settings: Settings | null): EffectiveTheme {
  const preference = settings?.general.theme ?? 'system';
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Apply appearance before publishing settings to React, avoiding a one-frame mixed skin. */
export function applyAppearance(settings: Settings | null): void {
  const root = document.documentElement;
  root.dataset.skin = settings?.general.skin ?? 'studio';
  root.dataset.theme = resolveEffectiveTheme(settings);
  root.style.setProperty('--font-editor', editorFontFamily(settings?.editor.fontFamily));
  const scale = settings?.general.uiScale ?? 1;
  root.style.fontSize = `${Math.round(13 * scale)}px`;
}

export function currentSkin(): AppearanceSkin {
  const skin = document.documentElement.dataset.skin;
  return skin === 'terminal' || skin === 'archive' || skin === 'index' ? skin : 'studio';
}

/** A user-entered editor font wins; the historical default follows the selected skin. */
export function editorFontFamily(configured: string | undefined): string {
  if (configured && configured !== DEFAULT_EDITOR_FONT_FAMILY) return configured;
  return EDITOR_FONTS[currentSkin()];
}
