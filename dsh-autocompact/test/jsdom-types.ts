/**
 * The real jsdom browser window these tests load the client artifact into.
 *
 * The package's `devDependencies` do not pin `jsdom` or `@types/jsdom` (the
 * Lead records that dev-pin decision for the package.json change), while the
 * repository installs jsdom through Vitest. This module loads the installed
 * runtime and declares only the surface the tests use.
 */
import { createRequire } from "node:module";

/** One `window.__ModuleLoader__.load({ id, factory })` registration. */
export interface ModuleRegistration {
  readonly id: string;
  readonly factory: (require: (id: string) => unknown) => unknown;
}

/** The jsdom window surface the client artifact and tests touch. */
export interface BrowserWindow {
  readonly document: Document;
  __ModuleLoader__?: { load(registration: ModuleRegistration): void };
  eval(code: string): unknown;
}

interface JSDOMInstance {
  readonly window: BrowserWindow;
}

type JSDOMConstructor = new (
  html?: string,
  options?: { readonly url?: string; readonly runScripts?: "dangerously" | "outside-only" },
) => JSDOMInstance;

const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom") as { JSDOM: JSDOMConstructor };

/**
 * Create one real jsdom window with scripts evaluated only through `eval`.
 *
 * @param html - initial document markup.
 * @returns the window the client artifact is evaluated in.
 */
export function createBrowserWindow(
  html = "<!doctype html><html><body></body></html>",
): BrowserWindow {
  return new JSDOM(html, { url: "http://localhost/", runScripts: "outside-only" }).window;
}
