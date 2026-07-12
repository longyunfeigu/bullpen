import React, { useEffect, useState } from 'react';
import { Workbench } from './workbench/Workbench.js';
import { StartupErrorView } from './views/StartupErrorView.js';
import { useAppStore } from './store/appStore.js';

function parseStartupError(): { code: string; message: string } | null {
  const hash = window.location.hash;
  if (!hash.startsWith('#/startup-error')) return null;
  const query = new URLSearchParams(hash.split('?')[1] ?? '');
  return {
    code: query.get('code') ?? 'APP_STARTUP_FAILED',
    message: query.get('msg') ?? 'The application failed to start.',
  };
}

export function App(): React.JSX.Element {
  const [startupError] = useState(parseStartupError);
  const ready = useAppStore((s) => s.ready);
  const init = useAppStore((s) => s.init);

  useEffect(() => {
    if (!startupError) void init();
  }, [startupError, init]);

  if (startupError) {
    return <StartupErrorView code={startupError.code} message={startupError.message} />;
  }
  if (!ready) {
    return (
      <div className="empty-state" data-testid="app-loading">
        Starting…
      </div>
    );
  }
  return <Workbench />;
}
