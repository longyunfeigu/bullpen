import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { RecentWorkspaceDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../bridge.js';
import { useAppStore } from '../store/appStore.js';
import { useWorkspaceStore } from '../store/workspaceStore.js';
import { useTaskStore, RUNNING_TASK_STATES } from '../store/taskStore.js';

const MODE_LABELS: Array<{ id: 'ask' | 'edit' | 'auto'; label: string; hint: string }> = [
  { id: 'ask', label: 'Read-only', hint: 'Answers questions; never writes or runs anything' },
  { id: 'edit', label: 'Approve changes', hint: 'Plans first; every write/command asks you' },
  { id: 'auto', label: 'Auto, pause on risk', hint: 'Low-risk actions run; risky ones ask' },
];

/**
 * Home surface (ADR-0004, PIVOT-001..007): one input to charter a task —
 * project, intent, approval policy and model inline. The full IDE stays one
 * click away.
 */
export function HomeView(): React.JSX.Element {
  const app = useAppStore();
  const workspaceStore = useWorkspaceStore();
  const taskStore = useTaskStore();
  const [intent, setIntent] = useState('');
  const [mode, setMode] = useState<'ask' | 'edit' | 'auto'>('edit');
  const [modelKey, setModelKey] = useState('');
  const [recent, setRecent] = useState<RecentWorkspaceDto[]>([]);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const workspace = workspaceStore.workspace;

  useEffect(() => {
    taskStore.init();
    void taskStore.refreshModels();
    void taskStore.refreshTasks();
    void rpcResult('workspace.recent', {}).then((res) => {
      if (res.ok) setRecent(res.data.items);
    });
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configuredModels = useMemo(
    () => taskStore.models.filter((m) => m.configured),
    [taskStore.models],
  );
  useEffect(() => {
    if (!modelKey && configuredModels.length > 0) {
      const preferred =
        configuredModels.find(
          (m) =>
            m.providerId === app.settings?.models.defaultProviderId &&
            m.modelId === app.settings?.models.defaultModelId,
        ) ?? configuredModels[0]!;
      setModelKey(`${preferred.providerId}::${preferred.modelId}`);
    }
  }, [configuredModels, modelKey, app.settings]);

  const submit = async (): Promise<void> => {
    if (!intent.trim() || submitting) return;
    if (!workspace) {
      app.pushToast('warning', 'Choose a project first.');
      setProjectMenuOpen(true);
      return;
    }
    const [providerId, modelId] = modelKey.split('::');
    if (!providerId || !modelId) {
      app.pushToast('warning', 'No model available — add a provider key in Settings.');
      return;
    }
    setSubmitting(true);
    const ok = await taskStore.createFromIntent({
      intent: intent.trim(),
      mode,
      model: { providerId, modelId },
    });
    setSubmitting(false);
    if (ok) {
      setIntent('');
      app.setSurface('workspace');
    }
  };

  const recentTasks = taskStore.tasks.slice(0, 6);

  return (
    <div
      data-testid="home-view"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        background: 'var(--bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        overflow: 'auto',
      }}
    >
      <div className="titlebar" style={{ alignSelf: 'stretch' }}>
        <span className="tb-spacer" style={{ flex: 1 }} />
        <button
          className="tb-chip"
          data-testid="home-enter-ide"
          onClick={() => app.setSurface('workspace')}
        >
          Open IDE workspace →
        </button>
      </div>

      <div
        style={{
          width: 'min(720px, 92vw)',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          marginTop: 'clamp(40px, 18vh, 160px)',
          paddingBottom: 60,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, letterSpacing: 2, color: 'var(--fg-muted)' }}>CHARTER</div>
          <h1 style={{ fontSize: 30, fontWeight: 650, margin: '14px 0 0 0' }}>
            What should we build?
          </h1>
        </div>

        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 14,
            background: 'var(--bg-card)',
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
          }}
        >
          <div style={{ position: 'relative' }}>
            <button
              className="btn"
              data-testid="home-project"
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
            >
              📁 {workspace ? workspace.displayName : 'Choose a project'} ▾
            </button>
            {projectMenuOpen ? (
              <div
                data-testid="home-project-menu"
                style={{
                  position: 'absolute',
                  top: '110%',
                  left: 0,
                  zIndex: 5,
                  minWidth: 320,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                  padding: 6,
                }}
              >
                {recent.map((r) => (
                  <button
                    key={r.path}
                    className="btn"
                    data-testid={`home-recent-${r.path}`}
                    style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none' }}
                    onClick={() => {
                      setProjectMenuOpen(false);
                      // Stay on Home: the user is mid-charter (submit switches surface).
                      app.setHomePick(true);
                      void workspaceStore.openPath(r.path);
                    }}
                  >
                    {r.displayName}
                    <span className="text-muted mono" style={{ fontSize: 10.5, display: 'block' }}>
                      {r.path}
                    </span>
                  </button>
                ))}
                <button
                  className="btn"
                  data-testid="home-open-folder"
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none' }}
                  onClick={() => {
                    setProjectMenuOpen(false);
                    app.setHomePick(true);
                    void workspaceStore.openViaDialog();
                  }}
                >
                  Open Folder…
                </button>
              </div>
            ) : null}
          </div>

          <textarea
            ref={inputRef}
            data-testid="home-intent"
            value={intent}
            placeholder="Describe what you want done — goal, constraints, how to verify…"
            rows={3}
            style={{
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              fontFamily: 'inherit',
              fontSize: 15,
              color: 'var(--fg)',
              lineHeight: 1.5,
            }}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              data-testid="home-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'ask' | 'edit' | 'auto')}
              title={MODE_LABELS.find((m) => m.id === mode)?.hint}
              style={{ maxWidth: 200 }}
            >
              {MODE_LABELS.map((m) => (
                <option key={m.id} value={m.id}>
                  ✋ {m.label}
                </option>
              ))}
            </select>
            <select
              data-testid="home-model"
              value={modelKey}
              onChange={(e) => setModelKey(e.target.value)}
              style={{ maxWidth: 260 }}
            >
              {configuredModels.length === 0 ? (
                <option value="">No model — add a key in Settings</option>
              ) : (
                configuredModels.map((m) => (
                  <option
                    key={`${m.providerId}::${m.modelId}`}
                    value={`${m.providerId}::${m.modelId}`}
                  >
                    {m.displayName}
                  </option>
                ))
              )}
            </select>
            <button
              className="btn"
              data-testid="home-settings"
              title="Providers & settings"
              onClick={() => {
                app.setSurface('workspace');
                app.setOverlay('settings');
              }}
            >
              ⚙
            </button>
            <span style={{ flex: 1 }} />
            <button
              className="btn primary"
              data-testid="home-submit"
              disabled={!intent.trim() || submitting}
              onClick={() => void submit()}
              aria-label="Start task"
              style={{ borderRadius: 999, width: 36, height: 36, fontSize: 16 }}
            >
              ↑
            </button>
          </div>
        </div>

        {recentTasks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>
              Recent tasks
            </div>
            {recentTasks.map((t) => (
              <button
                key={t.id}
                className="btn"
                data-testid={`home-task-${t.id}`}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                  textAlign: 'left',
                  padding: '8px 12px',
                }}
                onClick={() => {
                  void taskStore.openTask(t.id);
                  app.setSurface('workspace');
                  app.setLayout({ agentPanelVisible: true });
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {t.title}
                </span>
                <span
                  className="text-muted"
                  style={{
                    fontSize: 10.5,
                    color: RUNNING_TASK_STATES.has(t.state)
                      ? 'var(--info)'
                      : t.state === 'REVIEW_READY'
                        ? 'var(--warning)'
                        : undefined,
                  }}
                >
                  {t.state}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
