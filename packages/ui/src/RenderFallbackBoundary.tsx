import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';

interface RenderFallbackBoundaryProps extends PropsWithChildren {
  fallback: ReactNode;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface RenderFallbackBoundaryState {
  failed: boolean;
}

export class RenderFallbackBoundary extends Component<
  RenderFallbackBoundaryProps,
  RenderFallbackBoundaryState
> {
  override state: RenderFallbackBoundaryState = { failed: false };

  static getDerivedStateFromError(): RenderFallbackBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
