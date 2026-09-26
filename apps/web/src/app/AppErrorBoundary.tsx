import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

import { captureMonitoringException } from '../monitoring';

interface AppErrorBoundaryState {
  failed: boolean;
}

export class AppErrorBoundary extends Component<PropsWithChildren, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    void captureMonitoringException(error, { componentStack: errorInfo.componentStack ?? '' });
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <main className="fatal-error" role="alert">
          <p>页面暂时没有正常打开。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
