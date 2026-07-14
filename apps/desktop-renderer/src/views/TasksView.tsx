import React, { useEffect, useState } from 'react';
import { useTaskStore, RUNNING_TASK_STATES } from '../store/taskStore.js';
import { useAppStore } from '../store/appStore.js';
import { modeLabel, presentedMeta, TONE_COLOR } from './labels.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
  { id: 'failed', label: 'Stopped' },
] as const;

/** Editor-surface task list — compact segmented filter + Home-style rows. */
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
      <div className="tv-head">
        <div className="tv-seg" role="radiogroup" aria-label="Task filter">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={filter === f.id ? 'on' : ''}
              role="radio"
              aria-checked={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <span style={{ flex: 1 }} />
        <button
          className="tv-new"
          data-testid="tasks-new"
          title="Start a new task"
          onClick={() => {
            store.setNewTaskOpen(true);
            useAppStore.getState().setLayout({ agentPanelVisible: true });
          }}
        >
          ＋ New
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '2px 4px 8px' }}>
        {visible.length === 0 ? (
          <div className="empty-state">
            <div>No tasks{filter !== 'all' ? ' in this filter' : ' yet'}.</div>
          </div>
        ) : (
          visible.map((task) => {
            const meta = presentedMeta(task);
            return (
              <button
                key={task.id}
                className={`tv-row ${store.activeTaskId === task.id ? 'active' : ''}`}
                data-testid={`task-item-${task.id}`}
                onClick={() => {
                  void store.openTask(task.id);
                  useAppStore.getState().setLayout({ agentPanelVisible: true });
                }}
              >
                <span
                  className="tv-dot"
                  style={{ background: TONE_COLOR[meta.tone] }}
                  aria-hidden
                />
                <span className="tv-body">
                  <span className="tv-title">{task.title}</span>
                  <span className="tv-meta">
                    <span style={{ color: TONE_COLOR[meta.tone] }} data-state={task.state}>
                      {meta.short}
                    </span>
                    <span>·</span>
                    <span>{modeLabel(task.mode)}</span>
                    <span>·</span>
                    <span>
                      {new Date(task.updatedAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
