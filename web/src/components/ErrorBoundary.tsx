import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /** Shown in the fallback, so the viewer knows which part stopped rather than that "it broke". */
  what: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  message: string | null;
}

/**
 * Keeps one panel's failure from taking the page with it.
 *
 * Without a boundary, a single thrown render anywhere blanks the entire app, which during a
 * ninety second demo is unrecoverable. With one, the other panel, the counts and the feed all
 * keep running and the damage is a labelled box.
 *
 * Wrap each panel separately rather than the whole tree, or this just moves the blank screen
 * one level up. Still a class: React has no hook equivalent for catching render errors.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { message: error instanceof Error ? error.message : "Unknown error" };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the only place this can go. Nothing here phones home.
    console.error(`FindMySpot: ${this.props.what} failed to render`, error, info.componentStack);
  }

  render() {
    if (this.state.message === null) return this.props.children;

    return (
      <div className="solid flex flex-col items-start gap-2 rounded-card p-[26px]">
        <p className="font-display text-heading font-semibold">{this.props.what} stopped</p>
        <p className="text-small text-ink/50">
          The rest of the dashboard is still live. Reload to bring this panel back.
        </p>
        <code className="mt-1 block max-w-full overflow-x-auto rounded-chip bg-surface px-3 py-2 font-mono text-small text-ink/60">
          {this.state.message}
        </code>
      </div>
    );
  }
}
