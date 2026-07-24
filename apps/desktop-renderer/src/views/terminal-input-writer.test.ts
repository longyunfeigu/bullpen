import { describe, expect, it, vi } from 'vitest';
import {
  splitTerminalInput,
  TerminalInputWriter,
  type TerminalInputWrite,
} from './terminal-input-writer.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('splitTerminalInput', () => {
  it('preserves input exactly and emits complete pasted lines separately', () => {
    const input = `${'a'.repeat(7)}\n${'b'.repeat(7)}\n${'c'.repeat(7)}`;
    const chunks = splitTerminalInput(input, 10);

    expect(chunks).toEqual([`${'a'.repeat(7)}\n`, `${'b'.repeat(7)}\n`, 'c'.repeat(7)]);
    expect(chunks.join('')).toBe(input);
    expect(chunks.every((chunk) => Buffer.byteLength(chunk) <= 10)).toBe(true);
  });

  it('uses UTF-8 byte boundaries without splitting a surrogate pair', () => {
    expect(splitTerminalInput('abc😀def', 4)).toEqual(['abc', '😀', 'def']);
  });

  it('treats xterm-normalized carriage returns as pasted-line boundaries', () => {
    const input = 'first\rsecond\rthird';
    expect(splitTerminalInput(input, 256)).toEqual(['first\r', 'second\r', 'third']);
  });

  it('rejects invalid chunk limits', () => {
    expect(() => splitTerminalInput('text', 0)).toThrow(RangeError);
  });
});

describe('TerminalInputWriter', () => {
  it('serializes a large paste and a following Enter while retaining provenance', async () => {
    const firstSend = deferred();
    const writes: TerminalInputWrite[] = [];
    const send = vi.fn(async (input: TerminalInputWrite) => {
      writes.push(input);
      if (writes.length === 1) await firstSend.promise;
    });
    const wait = vi.fn(async () => undefined);
    const writer = new TerminalInputWriter(send, { wait });
    const paste = `${'x'.repeat(256)}\n${'y'.repeat(256)}`;

    writer.enqueue({ id: 'term-1', data: paste, userInitiated: true });
    writer.enqueue({ id: 'term-1', data: '\r', userInitiated: true });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]!.data).not.toBe('\r');

    firstSend.resolve();
    await vi.waitFor(() => expect(writes.at(-1)?.data).toBe('\r'));
    expect(
      writes
        .slice(0, -1)
        .map((write) => write.data)
        .join(''),
    ).toBe(paste);
    expect(writes.every((write) => write.userInitiated)).toBe(true);
    expect(wait).toHaveBeenCalled();
  });

  it('paces complete pasted lines instead of flooding the PTY', async () => {
    const pause = deferred();
    const writes: string[] = [];
    const writer = new TerminalInputWriter(
      async (input) => {
        writes.push(input.data);
      },
      { wait: () => pause.promise },
    );

    writer.enqueue({ id: 'term-1', data: 'first\nsecond\n', userInitiated: true });
    await vi.waitFor(() => expect(writes).toEqual(['first\n']));

    pause.resolve();
    await vi.waitFor(() => expect(writes).toEqual(['first\n', 'second\n']));
  });

  it('paces a single-chunk paste without leaking internal provenance', async () => {
    const pause = deferred();
    const writes: TerminalInputWrite[] = [];
    const writer = new TerminalInputWriter(
      async (input) => {
        writes.push(input);
      },
      { wait: () => pause.promise },
    );

    writer.enqueue({
      id: 'term-1',
      data: 'pasted text',
      userInitiated: true,
      paste: true,
    });
    writer.enqueue({ id: 'term-1', data: '\r', userInitiated: true });
    await vi.waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({ id: 'term-1', data: 'pasted text', userInitiated: true });

    pause.resolve();
    await vi.waitFor(() => expect(writes).toHaveLength(2));
  });

  it('does not delay ordinary single-chunk keystrokes', async () => {
    const send = vi.fn(async () => undefined);
    const writer = new TerminalInputWriter(send, { wait: () => new Promise(() => undefined) });

    writer.enqueue({ id: 'term-1', data: 'a', userInitiated: true });
    writer.enqueue({ id: 'term-1', data: '\r', userInitiated: true });

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  });

  it('settles queued input before a caller checks terminal state', async () => {
    const firstSend = deferred();
    const wait = vi.fn(async (milliseconds: number): Promise<void> => {
      if (milliseconds === 500) await new Promise<void>(() => undefined);
    });
    const send = vi.fn(async () => firstSend.promise);
    const writer = new TerminalInputWriter(send, { wait });
    let settled = false;

    writer.enqueue({ id: 'term-1', data: 'sleep 30\r', userInitiated: true });
    void writer.settle().then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(settled).toBe(false);

    firstSend.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    writer.markCommandStart();
    await vi.waitFor(() => expect(settled).toBe(true));
    expect(wait).toHaveBeenCalledOnce();
  });

  it('continues with later input after a failed IPC write', async () => {
    const writes: string[] = [];
    const send = vi.fn(async (input: TerminalInputWrite) => {
      writes.push(input.data);
      if (input.data === 'first') throw new Error('bridge closed');
    });
    const writer = new TerminalInputWriter(send);

    writer.enqueue({ id: 'term-1', data: 'first', userInitiated: false });
    writer.enqueue({ id: 'term-1', data: 'second', userInitiated: true });

    await vi.waitFor(() => expect(writes).toEqual(['first', 'second']));
  });

  it('holds early input until an adopted terminal is explicitly ready', async () => {
    const send = vi.fn(async () => undefined);
    const writer = new TerminalInputWriter(send, { startupDelayMs: 60_000 });

    writer.enqueue({ id: 'term-1', data: 'early', userInitiated: true });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    writer.markReady();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  });

  it('releases early input when shell integration reports the first prompt', async () => {
    const send = vi.fn(async () => undefined);
    const writer = new TerminalInputWriter(send, { startupDelayMs: 60_000 });

    writer.enqueue({ id: 'term-1', data: 'early', userInitiated: true });
    await Promise.resolve();
    expect(send).not.toHaveBeenCalled();

    writer.markPrompt();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
  });
});
