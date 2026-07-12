import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  createLogger,
  type LogEntry,
  type Logger,
  type LogLevel,
  type LogSink,
} from '@pi-ide/foundation';

const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_ROTATIONS = 5;

/** Rotating JSONL file sink; content redaction happens in createLogger (§18.4). */
export class FileLogSink implements LogSink {
  private readonly file: string;
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'app.log');
  }

  write(entry: LogEntry): void {
    try {
      this.rotateIfNeeded();
      appendFileSync(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // Logging must never crash the app.
    }
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.file)) return;
    const size = statSync(this.file).size;
    if (size < MAX_LOG_BYTES) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    renameSync(this.file, join(this.dir, `app.${stamp}.log`));
    const rotated = readdirSync(this.dir)
      .filter((f) => f.startsWith('app.') && f.endsWith('.log') && f !== 'app.log')
      .sort();
    while (rotated.length > MAX_ROTATIONS) {
      const oldest = rotated.shift()!;
      rmSync(join(this.dir, oldest), { force: true });
    }
  }
}

export class LogService {
  private readonly sink: LogSink;
  private readonly consoleAlso: boolean;
  readonly level: LogLevel;

  constructor(logsDir: string, opts: { level?: LogLevel; console?: boolean } = {}) {
    this.sink = new FileLogSink(logsDir);
    this.level = opts.level ?? 'info';
    this.consoleAlso = opts.console ?? false;
  }

  logger(component: string): Logger {
    const fileSink = this.sink;
    const consoleAlso = this.consoleAlso;
    const combined: LogSink = {
      write(entry) {
        fileSink.write(entry);
        if (consoleAlso) {
          const line = `[${entry.level}] ${entry.component}: ${entry.message}`;
          if (entry.level === 'error') console.error(line, entry.context ?? '');
          else console.log(line, entry.context ?? '');
        }
      },
    };
    return createLogger(component, combined, { minLevel: this.level });
  }
}
