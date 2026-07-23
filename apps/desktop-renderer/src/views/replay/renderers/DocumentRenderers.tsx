import React from 'react';
import type { ReplayFactDto } from '@pi-ide/ipc-contracts';
import { Ic } from '../../home-icons.js';
import { FileRenderer, useChangeFrame } from './FileRenderer.js';

/**
 * Document and spreadsheet renderers (Replay V3 §6.4). Both render only the
 * recorded before/after file versions from the blob store — a prose or table
 * presentation of real evidence, never a reconstructed preview. Anything the
 * evidence cannot support falls back to the plain file renderer.
 */

function addedLines(beforeText: string | null, afterText: string | null): Set<number> {
  const before = new Set((beforeText ?? '').split('\n'));
  const added = new Set<number>();
  (afterText ?? '').split('\n').forEach((line, index) => {
    if (line.trim() && !before.has(line)) added.add(index);
  });
  return added;
}

export function DocumentRenderer({
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
        <Ic name="file" size={26} />
        <h2>{fact.action}</h2>
        <p className="rp-empty-note">Loading the recorded document versions…</p>
      </div>
    );
  }
  if (frame.binary || (frame.beforeText === null && frame.afterText === null)) {
    return <FileRenderer fact={fact} taskId={taskId} />;
  }
  const added = addedLines(frame.beforeText, frame.afterText);
  return (
    <div className="rp-document-compare">
      <article className="rp-paper">
        <header>
          <Ic name="file" size={13} />
          <span>Before{frame.beforeHash ? ` · ${frame.beforeHash.slice(0, 10)}` : ''}</span>
        </header>
        <div className="rp-paper-body">
          {(frame.beforeText ?? '∅  Document did not exist').split('\n').map((line, index) => (
            <p key={index}>{line || ' '}</p>
          ))}
        </div>
      </article>
      <div className="rp-stage-arrow" aria-hidden>
        <Ic name="chevron" size={20} />
      </div>
      <article className="rp-paper after">
        <header>
          <Ic name="checkCircle" size={13} />
          <span>
            After · {frame.path}
            {frame.afterHash ? ` · ${frame.afterHash.slice(0, 10)}` : ''}
          </span>
        </header>
        <div className="rp-paper-body">
          {(frame.afterText ?? '∅  Document deleted').split('\n').map((line, index) => (
            <p key={index} className={added.has(index) ? 'changed' : ''}>
              {line || ' '}
            </p>
          ))}
        </div>
      </article>
    </div>
  );
}

function parseTable(text: string | null, path: string): string[][] {
  if (!text) return [];
  const separator = /\.tsv$/i.test(path) ? '\t' : ',';
  return text
    .split('\n')
    .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    .slice(0, 60)
    .map((line) => line.split(separator).slice(0, 20));
}

export function SpreadsheetRenderer({
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
        <Ic name="layout" size={26} />
        <h2>{fact.action}</h2>
        <p className="rp-empty-note">Loading the recorded table versions…</p>
      </div>
    );
  }
  if (frame.binary || frame.afterText === null) {
    return <FileRenderer fact={fact} taskId={taskId} />;
  }
  const before = parseTable(frame.beforeText, frame.path);
  const after = parseTable(frame.afterText, frame.path);
  const changedCell = (row: number, column: number) =>
    before[row]?.[column] !== after[row]?.[column];
  return (
    <div className="rp-sheet-artifact">
      <header>
        <Ic name="layout" size={14} />
        <span>{frame.path}</span>
        <small>Changed cells come from the recorded before/after versions</small>
      </header>
      <div className="rp-sheet-scroll">
        <table>
          <tbody>
            {after.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td
                    key={cellIndex}
                    className={changedCell(rowIndex, cellIndex) ? 'changed' : ''}
                    title={
                      changedCell(rowIndex, cellIndex)
                        ? `Before: ${before[rowIndex]?.[cellIndex] ?? '∅'}`
                        : undefined
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer>
        <Ic name="checkCircle" size={12} /> Both versions are stored as SHA-256 blobs for
        cell-by-cell comparison.
      </footer>
    </div>
  );
}
