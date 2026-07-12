import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    switch (label) {
      case 'json':
        return new jsonWorker();
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker();
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker();
      case 'typescript':
      case 'javascript':
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

monaco.editor.defineTheme('pi-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#1e1e1e',
  },
});
monaco.editor.defineTheme('pi-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#ffffff',
  },
});

export function applyMonacoTheme(): void {
  const dark = document.documentElement.dataset.theme !== 'light';
  monaco.editor.setTheme(dark ? 'pi-dark' : 'pi-light');
}

new MutationObserver(applyMonacoTheme).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-theme'],
});

export function modelUri(relativePath: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'pi-ws', path: `/${relativePath}` });
}

export { monaco };
