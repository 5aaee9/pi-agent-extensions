/**
 * The editable per-model threshold rows.
 *
 * @module @indexyz/dsh-autocompact/client/threshold-list
 */

import * as React from "react";
import type { Translate } from "./contracts.ts";
import { formatTokens, parseLimit } from "./limits.ts";
import type { Row } from "./state.ts";

/** Everything the row list needs; the page owns the state these props read. */
export interface ThresholdListProps {
  readonly t: Translate;
  readonly rows: readonly Row[];
  /** Staged text per row key, empty until an input is edited. */
  readonly draft: Readonly<Record<string, string>>;
  readonly busy: boolean;
  readonly readOnly: boolean;
  readonly onDraft: (key: string, value: string) => void;
  readonly onRemove: (key: string) => void;
}

/** Render one row per visible threshold, or the empty-state row. */
export function ThresholdList(props: ThresholdListProps): React.ReactElement {
  const { t, rows, draft, busy, readOnly, onDraft, onRemove } = props;
  const list: React.ReactNode[] = [];
  if (rows.length === 0) {
    list.push(
      <div key="empty" className="dsha-item dsha-muted">
        {t("empty")}
      </div>,
    );
  } else {
    for (const entry of rows) {
      const raw = draft[entry.key] ?? String(entry.value);
      const parsed = parseLimit(raw);
      list.push(
        <div key={entry.key} className="dsha-item">
          <span className="dsha-route" title={entry.key}>
            {entry.key}
          </span>
          <span className="dsha-hint" style={{ minWidth: 84, textAlign: "right" }}>
            {parsed === undefined ? "—" : formatTokens(parsed)}
          </span>
          <input
            className="dsha-input dsha-value"
            value={raw}
            disabled={busy || readOnly}
            aria-invalid={parsed === undefined ? "true" : "false"}
            aria-label={`${entry.key} ${t("threshold")}`}
            onChange={(event) => onDraft(entry.key, event.target.value)}
          />
          <button
            type="button"
            className="dsha-button dsha-button-danger"
            disabled={busy || readOnly}
            onClick={() => onRemove(entry.key)}
          >
            {t("remove")}
          </button>
        </div>,
      );
    }
  }
  return <>{list}</>;
}
