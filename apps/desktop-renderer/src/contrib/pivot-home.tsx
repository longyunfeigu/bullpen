import { homeSurfaceRegistry } from '../workbench/Workbench.js';
import { HomeView } from '../views/HomeView.js';
import { registerCommands } from '../commands.js';
import { useAppStore } from '../store/appStore.js';

/** Dual-form shell (ADR-0004): Home task launcher as the default entry. */
export function registerPivotHome(): void {
  homeSurfaceRegistry.main = HomeView;
  registerCommands([
    {
      id: 'surface.home',
      title: 'Go Home (Task Launcher)',
      category: 'View',
      run: () => useAppStore.getState().setSurface('home'),
    },
    {
      id: 'surface.workspace',
      title: 'Open IDE Workspace',
      category: 'View',
      run: () => useAppStore.getState().setSurface('workspace'),
    },
  ]);
}
