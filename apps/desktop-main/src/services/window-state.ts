import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { screen, type BrowserWindow, type Rectangle } from 'electron';

interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

/** APP-003: persist window bounds and clamp back onto a visible display. */
export class WindowStateKeeper {
  private state: WindowState | null = null;

  constructor(private readonly file: string) {
    try {
      if (existsSync(file)) {
        this.state = JSON.parse(readFileSync(file, 'utf8')) as WindowState;
      }
    } catch {
      this.state = null;
    }
  }

  initialBounds(defaults: { width: number; height: number }): Partial<Rectangle> & {
    maximized: boolean;
  } {
    if (!this.state) return { ...defaults, maximized: false };
    const displays = screen.getAllDisplays();
    const visible = displays.some((d) => {
      const a = d.workArea;
      const b = this.state!.bounds;
      return (
        b.x < a.x + a.width - 40 &&
        b.x + b.width > a.x + 40 &&
        b.y >= a.y - 20 &&
        b.y < a.y + a.height - 40
      );
    });
    if (!visible) return { ...defaults, maximized: false };
    return { ...this.state.bounds, maximized: this.state.maximized };
  }

  track(win: BrowserWindow): void {
    const save = () => {
      try {
        const state: WindowState = {
          bounds: win.getNormalBounds(),
          maximized: win.isMaximized(),
        };
        writeFileSync(this.file, JSON.stringify(state), 'utf8');
      } catch {
        // best effort
      }
    };
    win.on('resized', save);
    win.on('moved', save);
    win.on('maximize', save);
    win.on('unmaximize', save);
    win.on('close', save);
  }
}
