import React, { useEffect, useState } from 'react';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { useTaskStore } from '../store/taskStore.js';
import { Ic } from './home-icons.js';
import '../styles/settings.css';

/** Provider credentials + live model fetch (PIVOT-009/026, ONB-004/008). */
function ProvidersBlock(): React.JSX.Element {
  const pushToast = useAppStore((s) => s.pushToast);
  const [items, setItems] = useState<
    Array<{ providerId: string; configured: boolean; hint: string; baseUrl: string | null }>
  >([]);
  const [providerId, setProviderId] = useState('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

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
    setBusy('save');
    const res = await rpcResult('secrets.set', {
      providerId,
      apiKey: apiKey.trim(),
      ...(url ? { baseUrl: url } : {}),
    });
    setBusy(null);
    setApiKey('');
    if (res.ok) {
      pushToast('success', `Credential stored for ${providerId}.`);
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
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          style={{ width: 130, flex: 'none' }}
        >
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
        </select>
        <input
          className="st-input"
          data-testid="provider-key-input"
          type="password"
          placeholder="API key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          style={{ flex: 1, minWidth: 180 }}
        />
        <input
          className="st-input mono"
          data-testid="provider-baseurl-input"
          placeholder="Base URL (optional) — e.g. http://gateway:3000/api"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          style={{ flex: 1.2, minWidth: 220 }}
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
      <div className="st-hint">
        Base URL points this provider at a gateway/proxy (Anthropic-compatible or OpenAI-compatible
        endpoint). Leave empty for the official API.
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
            <span className="st-provider-name">{item.providerId}</span>
            <span className="mono st-provider-hint">{item.hint}</span>
            {item.baseUrl ? (
              <span
                className="mono st-provider-url"
                data-testid={`provider-baseurl-${item.providerId}`}
                title={item.baseUrl}
              >
                {item.baseUrl}
              </span>
            ) : (
              <span className="st-provider-url official">official API</span>
            )}
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
