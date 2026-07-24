export interface TerminalInputWrite {
  id: string;
  data: string;
  userInitiated: boolean;
}

interface TerminalInputEnqueue extends TerminalInputWrite {
  paste?: boolean;
}

export type SendTerminalInput = (input: TerminalInputWrite) => Promise<unknown>;
interface TerminalInputWriterOptions {
  wait?: (milliseconds: number) => Promise<void>;
  startupDelayMs?: number;
}

const MAX_CHUNK_BYTES = 256;
const PASTE_CHUNK_PAUSE_MS = 100;
const TERMINAL_SETTLE_MS = 50;
const COMMAND_START_TIMEOUT_MS = 500;

/**
 * Keep native paste below macOS PTY input-buffer limits while retaining exact
 * ordering with the Enter event that xterm emits immediately after the paste.
 */
export function splitTerminalInput(data: string, maxChunkBytes = MAX_CHUNK_BYTES): string[] {
  if (data.length === 0) return [];
  if (!Number.isInteger(maxChunkBytes) || maxChunkBytes < 1) {
    throw new RangeError('maxChunkBytes must be a positive integer');
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < data.length) {
    let end = start;
    let bytes = 0;
    while (end < data.length) {
      const codePoint = data.codePointAt(end)!;
      const units = codePoint > 0xffff ? 2 : 1;
      const nextBytes =
        codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
      if (bytes + nextBytes > maxChunkBytes && end > start) break;
      bytes += nextBytes;
      end += units;
      // xterm normalizes native-paste newlines to carriage returns. Treat
      // both terminal line endings as pacing boundaries.
      if (codePoint === 0x0a || codePoint === 0x0d) break;
      // A byte limit smaller than one code point still emits that point whole.
      if (bytes > maxChunkBytes) break;
    }
    chunks.push(data.slice(start, end));
    start = end;
  }
  return chunks;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TerminalInputWriter {
  private tail: Promise<void> = Promise.resolve();
  private readonly ready: Promise<void>;
  private resolveReady: (() => void) | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private submittedLineVersion = 0;
  private commandStartVersion = 0;
  private commandStartSignal: Promise<void>;
  private resolveCommandStart: () => void = () => undefined;

  constructor(
    private readonly send: SendTerminalInput,
    options: TerminalInputWriterOptions = {},
  ) {
    this.wait = options.wait ?? pause;
    this.commandStartSignal = this.newCommandStartSignal();
    const startupDelayMs = options.startupDelayMs ?? 0;
    if (startupDelayMs <= 0) {
      this.ready = Promise.resolve();
      return;
    }
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
      this.startupTimer = setTimeout(() => this.markReady(), startupDelayMs);
    });
  }

  private newCommandStartSignal(): Promise<void> {
    return new Promise((resolve) => {
      this.resolveCommandStart = resolve;
    });
  }

  markReady(): void {
    if (!this.resolveReady) return;
    if (this.startupTimer) clearTimeout(this.startupTimer);
    this.startupTimer = null;
    const resolve = this.resolveReady;
    this.resolveReady = null;
    resolve();
  }

  markPrompt(): void {
    this.markReady();
  }

  markCommandStart(): void {
    this.commandStartVersion = this.submittedLineVersion;
    this.resolveCommandStart();
    this.commandStartSignal = this.newCommandStartSignal();
  }

  enqueue(input: TerminalInputEnqueue): void {
    const deliver = async (): Promise<void> => {
      await this.ready;
      const chunks = splitTerminalInput(input.data);
      const pacedPaste = input.paste === true || chunks.length > 1;
      for (const chunk of chunks) {
        if (input.userInitiated && /[\r\n]/.test(chunk)) this.submittedLineVersion += 1;
        await this.send({
          id: input.id,
          data: chunk,
          userInitiated: input.userInitiated,
        });
        if (pacedPaste) await this.wait(PASTE_CHUNK_PAUSE_MS);
      }
    };

    // A failed IPC call must not strand later keystrokes behind a rejected tail.
    this.tail = this.tail.then(deliver, deliver);
    void this.tail.catch(() => undefined);
  }

  async settle(): Promise<void> {
    await this.tail.catch(() => undefined);
    if (this.commandStartVersion < this.submittedLineVersion) {
      // Shell integration reports command start just before the shell spawns
      // an external child. Unknown shells retain a bounded fallback.
      await Promise.race([this.commandStartSignal, this.wait(COMMAND_START_TIMEOUT_MS)]);
    }
    // Give the shell a turn to spawn a just-submitted child before close asks
    // the host whether confirmation is required.
    await this.wait(TERMINAL_SETTLE_MS);
  }
}
