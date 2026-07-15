import React, { useEffect, useState } from 'react';
import type { ReplayFactDto } from '@pi-ide/ipc-contracts';
import { rpcResult } from '../../../bridge.js';
import { Ic } from '../../home-icons.js';

export interface ChangeFrame {
  path: string;
  patch: string | null;
  beforeText: string | null;
  afterText: string | null;
  binary: boolean;
  beforeHash: string | null;
  afterHash: string | null;
}

export function useChangeFrame(taskId: string, changeId: string | null): ChangeFrame | null {
  const [frame, setFrame] = useState<ChangeFrame | null>(null);
  useEffect(() => {
    let disposed = false;
    setFrame(null);
    if (!changeId) return;
    void Promise.all([
      rpcResult('task.changeRecord', { taskId, changeId }),
      rpcResult('task.changeEvidence', { taskId, changeId }),
    ]).then(([recordResult, evidenceResult]) => {
      if (disposed || !recordResult.ok || !recordResult.data.record) return;
      const record = recordResult.data.record;
      const evidence = evidenceResult.ok ? evidenceResult.data.evidence : null;
      setFrame({
        path: record.path,
        patch: record.patch,
        beforeText: evidence?.beforeText ?? null,
        afterText: evidence?.afterText ?? null,
        binary: evidence?.binary ?? false,
        beforeHash: record.beforeHash,
        afterHash: record.afterHash,
      });
    });
    return () => {
      disposed = true;
    };
  }, [taskId, changeId]);
  return frame;
}

export function DiffPane({ patch }: { patch: string | null }): React.JSX.Element {
  if (!patch) {
    return <div className="rp-empty-note">No textual patch stored for this change.</div>;
  }
  return (
    <pre className="rp-patch mono" data-testid="replay-diff">
      {patch.split('\n').map((line, index) => (
        <span
          key={`${index}-${line.slice(0, 12)}`}
          className={
            line.startsWith('+') && !line.startsWith('+++')
              ? 'add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'del'
                : line.startsWith('@@')
                  ? 'hunk'
                  : ''
          }
        >
          {line || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

/** Before/after file versions plus the recorded patch (evidence-backed). */
export function FileRenderer({
  fact,
  taskId,
}: {
  fact: ReplayFactDto;
  taskId: string;
}): React.JSX.Element {
  const changeId = fact.changeIds?.[0] ?? null;
  const frame = useChangeFrame(taskId, changeId);
  if (!frame) {
    return (
      <div className="rp-generic-artifact">
        <Ic name="pencil" size={26} />
        <h2>{fact.action}</h2>
        <p className="rp-empty-note">Loading the recorded file versions…</p>
      </div>
    );
  }
  if (frame.binary) {
    return (
      <div className="rp-generic-artifact">
        <Ic name="file" size={26} />
        <h2>{frame.path}</h2>
        <p className="rp-empty-note">Binary change — before/after hashes are recorded.</p>
      </div>
    );
  }
  return (
    <div className="rp-version-stage">
      <section>
        <span>之前{frame.beforeHash ? ` · ${frame.beforeHash.slice(0, 10)}` : ''}</span>
        <pre className="mono">{frame.beforeText ?? '∅  File did not exist'}</pre>
      </section>
      <div className="rp-stage-arrow" aria-hidden>
        <Ic name="chevron" size={20} />
      </div>
      <section className="after">
        <span>
          之后 · {frame.path}
          {frame.afterHash ? ` · ${frame.afterHash.slice(0, 10)}` : ''}
        </span>
        <pre className="mono">{frame.afterText ?? '∅  File deleted'}</pre>
      </section>
      <DiffPane patch={frame.patch} />
    </div>
  );
}
