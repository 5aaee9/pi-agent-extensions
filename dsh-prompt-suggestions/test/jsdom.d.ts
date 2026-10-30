/**
 * Minimal declaration for the pinned jsdom package, which ships without types.
 * Only the surface the release smoke uses is declared.
 */
declare module "jsdom" {
  export interface JSDOMOptions {
    readonly url?: string;
    readonly pretendToBeVisual?: boolean;
  }

  export class JSDOM {
    constructor(html?: string, options?: JSDOMOptions);
    readonly window: Window & typeof globalThis;
  }
}
