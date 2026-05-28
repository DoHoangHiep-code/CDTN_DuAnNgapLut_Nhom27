import type { ReactNode } from 'react'
import { Component } from 'react'
import { Button } from './Button'

type Props = { children: ReactNode }
type State = { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    // Intentionally keep this minimal: we surface the error in the UI.
    // You can wire this into Sentry / LogRocket later.
    console.error(error)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="min-h-dvh bg-slate-50 px-4 py-10 text-slate-900 dark:bg-slate-950 dark:text-slate-50">
        <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm dark:border-rose-900/40 dark:bg-slate-900">
          <div className="text-lg font-extrabold">App crashed</div>
          <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            There is a runtime error preventing the UI from rendering.
          </div>
          <pre className="mt-4 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-50">
            {this.state.error.message}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="ghost" onClick={() => this.setState({ error: null })}>
              Try continue
            </Button>
          </div>
        </div>
      </div>
    )
  }
}

