/**
 * The section's own crash boundary.
 *
 * @module @indexyz/dsh-autocompact/client/crash-boundary
 */

import * as React from "react";
import { CSS } from "./styles.ts";

/**
 * This section's own crash face.
 *
 * The shell isolates one settings entry per boundary and retires an entry
 * that throws while rendering, so an uncaught crash here shows as an empty
 * page with the nav row still in place — no message, no stack, nothing to
 * report. Holding the boundary inside the section keeps the failure on the
 * page instead: the panel stays, the message and stack are visible, and the
 * crash is logged for the console.
 */
export class PageCrashBoundary extends React.Component<
  { readonly title: string; readonly hint: string; readonly children?: React.ReactNode },
  { readonly error: unknown }
> {
  constructor(props: { readonly title: string; readonly hint: string }) {
    super(props);
    this.state = { error: undefined };
  }

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  componentDidCatch(error: unknown): void {
    try {
      console.error("[dsh-autocompact] settings section crashed:", error);
    } catch {
      // Logging must never become the crash.
    }
  }

  render(): React.ReactNode {
    if (this.state.error === undefined) return this.props.children;
    const detail =
      this.state.error instanceof Error
        ? (this.state.error.stack ?? this.state.error.message)
        : String(this.state.error);
    return (
      <section className="dsha-page">
        <style>{CSS}</style>
        <h2 className="dsha-title">{this.props.title}</h2>
        <p className="dsha-notice dsha-notice-error" role="alert">
          {this.props.hint}
        </p>
        <pre className="dsha-crash">{detail}</pre>
      </section>
    );
  }
}

/**
 * The composer status line's own crash guard.
 *
 * The status line is decoration around the composer: a failure there must not
 * take the composer entry down with it, and a stack does not belong above the
 * input box. This boundary logs the failure and renders nothing, so the line
 * simply disappears instead of breaking the session view.
 */
export class StatusLineCrashBoundary extends React.Component<
  { readonly children?: React.ReactNode },
  { readonly failed: boolean }
> {
  constructor(props: { readonly children?: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    try {
      console.error("[dsh-autocompact] composer status crashed:", error);
    } catch {
      // Logging must never become the crash.
    }
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
