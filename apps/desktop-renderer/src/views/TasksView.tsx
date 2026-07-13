import React, { useEffect, useState } from 'react';
import { useTaskStore, RUNNING_TASK_STATES } from '../store/taskStore.js';
import { useAppStore } from '../store/appStore.js';
import { stateShort, stateTone, TONE_COLOR, modeLabel } from './labels.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Stopped' },
] as const;

export function TasksView(): React.JSX.Element {
  const store = useTaskStore();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');

  useEffect(() => {
    store.init();
    void store.refreshTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = store.tasks.filter((t) => {
    switch (filter) {
      case 'active':
        return (
          RUNNING_TASK_STATES.has(t.state) ||
          t.state === 'READY' ||
          t.state === 'AWAITING_PLAN_APPROVAL'
        );
      case 'review':
        return t.state === 'REVIEW_READY';
      case 'done':
        return ['ACCEPTED', 'ROLLED_BACK', 'ARCHIVED'].includes(t.state);
      case 'failed':
        return ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(t.state);
      default:
        return true;
    }
  });

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      data-testid="tasks-view"
    >
      <div style={{ display: 'flex', gap: 4, padding: 8, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className="btn"
            style={{
              padding: '2px 8px',
              fontSize: 11,
              background: filter === f.id ? 'var(--bg-selected)' : undefined,
            }}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          className="btn primary"
          style={{ padding: '2px 8px', fontSize: 11 }}
          data-testid="tasks-new"
          onClick={() => {
            store.setNewTaskOpen(true);
            useAppStore.getState().setLayout({ agentPanelVisible: true });
          }}
        >
          ＋ New
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {visible.length === 0 ? (
          <div className="empty-state">
            <div>No tasks{filter !== 'all' ? ' in this filter' : ' yet'}.</div>
          </div>
        ) : (
          visible.map((task) => (
            <button
              key={task.id}
              className="quickpick-item"
              data-testid={`task-item-${task.id}`}
              style={{
                display: 'block',
                background: store.activeTaskId === task.id ? 'var(--bg-selected)' : undefined,
                padding: '8px 12px',
              }}
              onClick={() => {
                void store.openTask(task.id);
                useAppStore.getState().setLayout({ agentPanelVisible: true });
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span
                  style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600 }}
                >
                  {task.title}
                </span>
              </div>
              <div className="text-muted" style={{ fontSize: 11, display: 'flex', gap: 8 }}>
                <span style={{ color: TONE_COLOR[stateTone(task.state)] }} data-state={task.state}>
                  {stateShort(task.state)}
                </span>
                <span>{modeLabel(task.mode)}</span>
                <span>{new Date(task.updatedAt).toLocaleTimeString()}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
