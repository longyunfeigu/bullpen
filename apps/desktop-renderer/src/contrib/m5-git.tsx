import {
  viewRegistry,
  statusBarRegistry,
  overlayRegistry,
  initRegistry,
} from '../workbench/Workbench.js';
import { ScmView, BranchStatusItem, BranchPicker, useGitStore } from '../views/ScmView.js';

export function registerM5(): void {
  viewRegistry.scm = ScmView;
  statusBarRegistry.left.unshift(BranchStatusItem);
  overlayRegistry.push(BranchPicker);
  initRegistry.push(() => {
    useGitStore.getState().init();
  });
}
