import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("Uncaught error caught by ErrorBoundary:", error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = (): void => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-background p-6 text-textPrimary select-none">
          <div className="flex max-w-md flex-col items-center text-center p-8 rounded-2xl bg-surface border border-white/[0.08] shadow-2xl backdrop-blur-md">
            <div className="w-12 h-12 rounded-full bg-danger/15 text-danger flex items-center justify-center mb-4 border border-danger/30">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h1 className="text-lg font-bold tracking-tight mb-2">Something went wrong</h1>
            <p className="text-xs text-textSecondary mb-4 leading-relaxed">
              An unexpected error occurred in the interface. You can attempt to recover the session or reload the player.
            </p>
            {this.state.error?.message && (
              <pre className="w-full text-left p-3 mb-6 bg-deck border border-white/[0.06] rounded-xl text-2xs font-mono text-danger/90 overflow-x-auto max-h-32 select-text">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex items-center gap-3 w-full">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex-1 px-4 py-2 rounded-xl text-xs font-semibold bg-white/[0.06] hover:bg-white/[0.12] active:scale-95 text-white transition border border-white/[0.08]"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-accent-fill hover:bg-accentHover active:scale-95 text-white transition shadow-lg shadow-accent/20"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reload</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
