import React, { useEffect, useState } from 'react';
import { PROVIDER_PRESETS, providerPreset, type ProviderInfoDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { useTaskStore } from '../store/taskStore.js';
import { Ic } from './home-icons.js';
import '../styles/settings.css';

const API_LABEL: Record<string, string> = {
  anthropic: 'Claude API',
  openai: 'OpenAI API',
};

/** Multi-provider credentials + live model fetch (PIVOT-009/026/033). */
function ProvidersBlock(): React.JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);
  const [items, setItems] = useState<ProviderInfoDto[]>([]);
  const [choice, setChoice] = useState('anthropic'); // preset id or 'custom'
  const [customId, setCustomId] = useState('');
  const [customName, setCustomName] = useState('');
  const [customApi, setCustomApi] = useState<'anthropic' | 'openai'>('openai');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const preset = choice === 'custom' ? null : providerPreset(choice);
  const isCustom = choice === 'custom';

  const refresh = async (): Promise<void> => {
    const res = await rpcResult('secrets.list', {});
    if (res.ok) setItems(res.data.items);
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (): Promise<void> => {
    if (!apiKey.trim()) return;
    const url = baseUrl.trim();
    if (url && !/^https?:\/\/\S+$/.test(url)) {
      pushToast('warning', 'Base URL must start with http:// or https://');
      return;
    }
    const providerId = isCustom ? customId.trim().toLowerCase().replace(/\s+/g, '-') : choice;
    if (isCustom && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(providerId)) {
      pushToast('warning', 'Custom provider id: lowercase letters, digits and dashes.');
      return;
    }
    if (isCustom && !url) {
      pushToast('warning', 'Custom providers need a Base URL.');
      return;
    }
    if (preset?.baseUrlRequired && !url) {
      pushToast(
        'warning',
        `${preset.displayName} needs its Base URL (e.g. ${preset.placeholder}).`,
      );
      return;
    }
    setBusy('save');
    const res = await rpcResult('secrets.set', {
      providerId,
      apiKey: apiKey.trim(),
      ...(url ? { baseUrl: url } : {}),
      ...(isCustom
        ? { api: customApi, ...(customName.trim() ? { displayName: customName.trim() } : {}) }
        : { api: preset!.api, displayName: preset!.displayName }),
    });
    setBusy(null);
    setApiKey('');
    if (res.ok) {
      pushToast('success', `Credential stored for ${providerId}.`);
      setCustomId('');
      setCustomName('');
      setBaseUrl('');
      await refresh();
      await useTaskStore.getState().refreshModels();
    } else {
      pushToast('error', res.error.userMessage);
    }
  };

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(`Delete the ${id} credential? Running tasks lose access immediately.`)) {
      return;
    }
    const res = await rpcResult('secrets.delete', { providerId: id });
    if (res.ok) {
      pushToast('info', `Credential for ${id} deleted.`);
      await refresh();
      await useTaskStore.getState().refreshModels();
    } else {
      pushToast('error', res.error.userMessage);
    }
  };

  const fetchModels = async (id: string): Promise<void> => {
    setBusy(`fetch-${id}`);
    const res = await rpcResult('models.fetchRemote', { providerId: id });
    setBusy(null);
    if (res.ok) {
      pushToast('success', `${res.data.models.length} models fetched from ${id}.`);
      await useTaskStore.getState().refreshModels();
    } else {
      pushToast('error', res.error.userMessage);
    }
  };

  return (
    <div className="st-card">
      <div className="st-card-head">
        <Ic name="shield" size={14} />
        <div>
          <div className="st-card-title">Providers</div>
          <div className="st-card-sub">
            Keys live in the encrypted OS keychain scope — never in files, the renderer or logs.
          </div>
        </div>
      </div>

      <div className="st-provider-form">
        <select
          className="st-input"
          data-testid="provider-select"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
          style={{ width: 130, flex: 'none' }}
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.providerId} value={p.providerId}>
              {p.displayName}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {isCustom ? (
          <>
            <input
              className="st-input mono"
              data-testid="provider-custom-id"
              placeholder="id (e.g. my-gateway)"
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              style={{ width: 140, flex: 'none' }}
            />
            <select
              className="st-input"
              data-testid="provider-custom-api"
              value={customApi}
              onChange={(e) => setCustomApi(e.target.value as 'anthropic' | 'openai')}
              style={{ width: 170, flex: 'none' }}
              title="Wire protocol the endpoint speaks"
            >
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic-compatible</option>
            </select>
          </>
        ) : null}
        <input
          className="st-input"
          data-testid="provider-key-input"
          type="password"
          placeholder="API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ flex: 1, minWidth: 160 }}
        />
        <input
          className="st-input mono"
          data-testid="provider-baseurl-input"
          placeholder={
            isCustom
              ? 'Base URL (required) — e.g. http://gateway:4000/v1'
              : `Base URL — ${preset?.placeholder ?? ''}`
          }
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          style={{ flex: 1.2, minWidth: 200 }}
        />
        <button
          className="btn primary"
          data-testid="provider-key-save"
          disabled={!apiKey.trim() || busy === 'save'}
          onClick={() => void save()}
        >
          Save
        </button>
      </div>
      {isCustom ? (
        <div className="st-provider-form" style={{ marginTop: 6 }}>
          <input
            className="st-input"
            data-testid="provider-custom-name"
            placeholder="Display name (optional — e.g. Team Gateway)"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      ) : null}
      <div className="st-hint">
        {isCustom
          ? 'Any Anthropic- or OpenAI-compatible endpoint works — LiteLLM, vLLM, Ollama, team gateways. OpenAI-compatible base URLs include /v1.'
          : preset?.baseUrlRequired
            ? `${preset.displayName} is self-hosted — point the Base URL at your instance.`
            : 'Leave the Base URL empty for the official API, or point it at a compatible gateway/proxy.'}
      </div>

      {items.length === 0 ? (
        <div className="st-empty" data-testid="providers-empty">
          No provider credentials yet. Add a key above, then fetch its live model list.
        </div>
      ) : (
        items.map((item) => (
          <div
            key={item.providerId}
            className="st-provider-row"
            data-testid={`provider-row-${item.providerId}`}
          >
            <span className="st-provider-name" title={item.providerId}>
              {item.displayName}
            </span>
            <span className="st-provider-api" data-testid={`provider-api-${item.providerId}`}>
              {API_LABEL[item.api] ?? item.api}
            </span>
            <span className="mono st-provider-hint">{item.hint}</span>
            {(() => {
              // Presets with a default endpoint (OpenRouter) show it even when
              // the user left the field empty — that IS where requests go.
              const effective =
                item.baseUrl ?? providerPreset(item.providerId)?.defaultBaseUrl ?? null;
              return effective ? (
                <span
                  className="mono st-provider-url"
                  data-testid={`provider-baseurl-${item.providerId}`}
                  title={effective}
                >
                  {effective}
                  {item.baseUrl === null ? ' (default)' : ''}
                </span>
              ) : (
                <span className="st-provider-url official">official API</span>
              );
            })()}
            <button
              className="btn"
              data-testid={`provider-fetch-${item.providerId}`}
              disabled={busy === `fetch-${item.providerId}`}
              onClick={() => void fetchModels(item.providerId)}
              title="Pull the live model list from this endpoint"
            >
              {busy === `fetch-${item.providerId}` ? 'Fetching…' : 'Fetch models'}
            </button>
            <button
              className="btn quiet-danger"
              data-testid={`provider-delete-${item.providerId}`}
              onClick={() => void remove(item.providerId)}
            >
              Delete
            </button>
          </div>
        ))
      )}
    </div>
  );
}

type Section =
  | 'general'
  | 'editor'
  | 'terminal'
  | 'agent'
  | 'models'
  | 'permissions'
  | 'privacy'
  | 'updates'
  | 'about';

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'general', label: 'General', icon: 'sliders' },
  { id: 'editor', label: 'Editor', icon: 'pencil' },
  { id: 'terminal', label: 'Terminal', icon: 'terminal' },
  { id: 'agent', label: 'Agent', icon: 'bot' },
  { id: 'models', label: 'Models', icon: 'zap' },
  { id: 'permissions', label: 'Permissions', icon: 'shield' },
  { id: 'privacy', label: 'Privacy', icon: 'eye' },
  { id: 'updates', label: 'Updates', icon: 'refresh' },
  { id: 'about', label: 'About', icon: 'info' },
];

function Row(props: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="st-row">
      <span className="st-row-label">
        {props.label}
        {props.hint ? <span className="st-row-hint">{props.hint}</span> : null}
      </span>
      <span className="st-row-control">{props.children}</span>
    </label>
  );
}

/** iOS-style switch on top of a real checkbox (keyboard/AT semantics intact). */
function Toggle(props: {
  checked: boolean;
  onChange: (next: boolean) => void;
  testid?: string;
}): React.JSX.Element {
  return (
    <span className={`st-toggle ${props.checked ? 'on' : ''}`}>
      <input
        type="checkbox"
        {...(props.testid ? { 'data-testid': props.testid } : {})}
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <i />
    </span>
  );
}

export function SettingsView(): React.JSX.Element {
  const settings = useAppStore((s) => s.settings);
  const issues = useAppStore((s) => s.settingsIssues);
  const appInfo = useAppStore((s) => s.appInfo);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [section, setSection] = useState<Section>('general');

  if (!settings) return <div className="empty-state">Loading settings…</div>;

  const set = (patch: Record<string, unknown>) => void updateSettings('global', patch);

  return (
    <div className="st-root">
      <nav aria-label="Settings sections" className="st-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`st-nav-item ${s.id === section ? 'active' : ''}`}
            onClick={() => setSection(s.id)}
          >
            <Ic name={s.icon} size={14} />
            {s.label}
          </button>
        ))}
      </nav>
      <div className="st-body">
        {issues.length > 0 ? (
          <div className="st-issues">
            {issues.length} setting value(s) were invalid and fell back to defaults.
          </div>
        ) : null}

        {section === 'general' ? (
          <div className="st-card">
            <Row label="Theme">
              <select
                className="st-input"
                value={settings.general.theme}
                onChange={(e) => set({ general: { theme: e.target.value } })}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </Row>
            <Row label="UI scale" hint="0.8 – 2.0">
              <input
                className="st-input"
                type="number"
                step="0.05"
                min={0.8}
                max={2}
                value={settings.general.uiScale}
                onChange={(e) => set({ general: { uiScale: Number(e.target.value) } })}
              />
            </Row>
            <Row
              label="Rich Markdown by default"
              hint="Open .md files in the Notion-style editor (toggle per file on the tab)"
            >
              <Toggle
                testid="settings-md-rich"
                checked={settings.editor.markdownRichDefault}
                onChange={(v) => set({ editor: { markdownRichDefault: v } })}
              />
            </Row>
            <Row
              label="System notifications"
              hint="Plan approval · permission · review ready · failed (silent while focused)"
            >
              <Toggle
                testid="settings-notifications"
                checked={settings.notifications.enabled}
                onChange={(v) => set({ notifications: { enabled: v } })}
              />
            </Row>
          </div>
        ) : null}

        {section === 'editor' ? (
          <div className="st-card">
            <Row label="Font size">
              <input
                className="st-input"
                type="number"
                min={8}
                max={40}
                value={settings.editor.fontSize}
                onChange={(e) => set({ editor: { fontSize: Number(e.target.value) } })}
              />
            </Row>
            <Row label="Font family">
              <input
                className="st-input wide"
                value={settings.editor.fontFamily}
                onChange={(e) => set({ editor: { fontFamily: e.target.value } })}
              />
            </Row>
            <Row label="Tab size">
              <input
                className="st-input"
                type="number"
                min={1}
                max={8}
                value={settings.editor.tabSize}
                onChange={(e) => set({ editor: { tabSize: Number(e.target.value) } })}
              />
            </Row>
            <Row label="Word wrap">
              <select
                className="st-input"
                value={settings.editor.wordWrap}
                onChange={(e) => set({ editor: { wordWrap: e.target.value } })}
              >
                <option value="off">Off</option>
                <option value="on">On</option>
              </select>
            </Row>
            <Row label="Minimap">
              <Toggle
                checked={settings.editor.minimap}
                onChange={(v) => set({ editor: { minimap: v } })}
              />
            </Row>
            <Row label="Auto save">
              <select
                className="st-input"
                value={settings.editor.autoSave}
                onChange={(e) => set({ editor: { autoSave: e.target.value } })}
              >
                <option value="off">Off</option>
                <option value="afterDelay">After delay</option>
                <option value="onFocusChange">On focus change</option>
              </select>
            </Row>
            <Row label="Auto save delay (ms)">
              <input
                className="st-input"
                type="number"
                min={200}
                max={60000}
                value={settings.editor.autoSaveDelayMs}
                onChange={(e) => set({ editor: { autoSaveDelayMs: Number(e.target.value) } })}
              />
            </Row>
            <Row
              label="Large file threshold (MB)"
              hint="Beyond this size semantic features degrade"
            >
              <input
                className="st-input"
                type="number"
                min={1}
                max={512}
                value={settings.editor.largeFileSizeMb}
                onChange={(e) => set({ editor: { largeFileSizeMb: Number(e.target.value) } })}
              />
            </Row>
          </div>
        ) : null}

        {section === 'terminal' ? (
          <div className="st-card">
            <Row label="Font size">
              <input
                className="st-input"
                type="number"
                min={8}
                max={32}
                value={settings.terminal.fontSize}
                onChange={(e) => set({ terminal: { fontSize: Number(e.target.value) } })}
              />
            </Row>
            <Row label="Shell path" hint="Empty = system default shell">
              <input
                className="st-input wide mono"
                placeholder="/bin/zsh"
                value={settings.terminal.shellPath ?? ''}
                onChange={(e) => set({ terminal: { shellPath: e.target.value || null } })}
              />
            </Row>
            <Row label="Scrollback lines">
              <input
                className="st-input"
                type="number"
                min={100}
                max={200000}
                value={settings.terminal.scrollback}
                onChange={(e) => set({ terminal: { scrollback: Number(e.target.value) } })}
              />
            </Row>
          </div>
        ) : null}

        {section === 'agent' ? (
          <div className="st-card">
            <Row label="Default mode">
              <select
                className="st-input"
                value={settings.agent.defaultMode}
                onChange={(e) => set({ agent: { defaultMode: e.target.value } })}
              >
                <option value="ask">Read-only</option>
                <option value="edit">Approve changes</option>
                <option value="auto">Auto · pause on risk</option>
              </select>
            </Row>
            <Row
              label="Auto mode: auto-approve workspace edits (R1)"
              hint="Off = Auto only auto-approves read-only tools"
            >
              <Toggle
                checked={settings.agent.autoApproveR1}
                onChange={(v) => set({ agent: { autoApproveR1: v } })}
              />
            </Row>
            <Row
              label="Auto mode: auto-approve recognized verification commands (R2)"
              hint="npm test / lint / typecheck detected from the project"
            >
              <Toggle
                checked={settings.agent.autoApproveKnownR2}
                onChange={(v) => set({ agent: { autoApproveKnownR2: v } })}
              />
            </Row>
          </div>
        ) : null}

        {section === 'models' ? (
          <>
            <div className="st-card">
              <Row label="Default thinking level">
                <select
                  className="st-input"
                  value={settings.models.defaultThinkingLevel}
                  onChange={(e) => set({ models: { defaultThinkingLevel: e.target.value } })}
                >
                  {['off', 'minimal', 'low', 'medium', 'high', 'max'].map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Deterministic mock runtime" hint="For demos/tests without a provider">
                <Toggle
                  checked={settings.models.useMockRuntime}
                  onChange={(v) => set({ models: { useMockRuntime: v } })}
                />
              </Row>
            </div>
            <ProvidersBlock />
          </>
        ) : null}

        {section === 'permissions' ? (
          <div className="st-card st-prose">
            <div className="st-card-title" style={{ marginBottom: 8 }}>
              Risk policy defaults (spec §10.2)
            </div>
            <ul>
              <li>
                <b>R0</b> read-only — allowed automatically in every mode.
              </li>
              <li>
                <b>R1</b> reversible workspace writes — Edit asks / plan approval; Auto per setting.
              </li>
              <li>
                <b>R2</b> local execution — recognized verification commands may run; unknown ask.
              </li>
              <li>
                <b>R3</b> external / hard-to-reverse — always asks, never permanently allowed.
              </li>
              <li>
                <b>R4</b> forbidden — sudo, git push, writes outside the workspace: always blocked.
              </li>
            </ul>
            <p className="st-hint">
              Per-workspace grants appear here once made from permission cards.
            </p>
          </div>
        ) : null}

        {section === 'privacy' ? (
          <div className="st-card">
            <Row
              label="Product analytics"
              hint="Default off. Never includes code, prompts or paths."
            >
              <Toggle
                checked={settings.privacy.telemetryEnabled}
                onChange={(v) => set({ privacy: { telemetryEnabled: v } })}
              />
            </Row>
            <Row label="Crash reports" hint="Separate opt-in with redacted preview">
              <Toggle
                checked={settings.privacy.crashReportsEnabled}
                onChange={(v) => set({ privacy: { crashReportsEnabled: v } })}
              />
            </Row>
            <div className="st-hint" style={{ padding: '10px 2px 2px' }}>
              All code, tasks, timelines and diffs stay on this machine. Model requests go directly
              to your configured provider.
            </div>
          </div>
        ) : null}

        {section === 'updates' ? (
          <div className="st-card">
            <Row label="Channel">
              <select
                className="st-input"
                value={settings.updates.channel}
                onChange={(e) => set({ updates: { channel: e.target.value } })}
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </select>
            </Row>
            <Row label="Check automatically">
              <Toggle
                checked={settings.updates.autoCheck}
                onChange={(v) => set({ updates: { autoCheck: v } })}
              />
            </Row>
          </div>
        ) : null}

        {section === 'about' && appInfo ? (
          <div className="st-card st-prose">
            <div className="st-about-name">
              <Ic name="flag" size={18} />
              <b>Charter</b> <span className="text-muted">{appInfo.appVersion}</span>
            </div>
            <div className="mono st-about-meta">
              Electron {appInfo.electron} · Node {appInfo.node} · Chrome {appInfo.chrome}
              <br />
              Agent engine {appInfo.piSdkVersion ?? 'not installed'}
              <br />
              Commit {appInfo.commit ?? 'n/a'} · Channel {appInfo.updateChannel}
              <br />
              Data: {appInfo.userDataDir}
            </div>
            <p className="st-hint">
              Local-first: your code and tasks stay on this machine. License: MIT.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
