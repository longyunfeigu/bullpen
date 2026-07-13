import { viewRegistry, agentPanelRegistry, initRegistry } from '../workbench/Workbench.js';
import { registerCommands } from '../commands.js';
import { TasksView } from '../views/TasksView.js';
import { AgentPanel } from '../views/AgentPanel.js';
import { useTaskStore } from '../store/taskStore.js';
import { useAppStore } from '../store/appStore.js';

export function registerM6(): void {
  viewRegistry.tasks = TasksView;
  agentPanelRegistry.main = AgentPanel;
  initRegistry.push(() => {
    useTaskStore.getState().init();
  });
  registerCommands([
    {
      id: 'task.new',
      title: 'New Agent Task…',
      category: 'Agent',
      keybinding: 'mod+shift+i',
      run: () => {
        useAppStore.getState().setLayout({ agentPanelVisible: true });
        useTaskStore.getState().setNewTaskOpen(true);
      },
    },
    {
      id: 'task.stop',
      title: 'Stop Agent',
      category: 'Agent',
      keybinding: 'mod+escape',
      run: () => void useTaskStore.getState().stop(),
    },
  ]);
}
