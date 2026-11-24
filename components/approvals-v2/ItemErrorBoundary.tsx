'use client';

import { Component, type ReactNode } from 'react';

interface ItemErrorBoundaryProps {
  children?: ReactNode;
  title?: string;
  onError?: () => void;
  fallback?: (retry: () => void) => ReactNode;
}

export class ItemErrorBoundary extends Component<ItemErrorBoundaryProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError?.();
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback(() => this.setState({ hasError: false }));

    return <div role="alert" className="rounded-lg border border-border bg-muted p-3 text-sm">
      {this.props.title && <p className="font-medium">{this.props.title}</p>}
      <p>This item couldn't be displayed.</p>
    </div>;
  }
}
