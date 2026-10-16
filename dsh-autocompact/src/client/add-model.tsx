/**
 * The add-model controls: a catalog picker, or a manual route field.
 *
 * @module @indexyz/dsh-autocompact/client/add-model
 */

import * as React from "react";
import type { CatalogGroup, Translate } from "./contracts.ts";
import type { Pick } from "./state.ts";

/** Everything the add controls need; the page owns the draft they edit. */
export interface AddModelProps {
  readonly t: Translate;
  readonly groups: readonly CatalogGroup[];
  readonly selectedGroup: CatalogGroup | undefined;
  readonly pick: Pick;
  readonly busy: boolean;
  readonly readOnly: boolean;
  readonly duplicate: boolean;
  /** Whether the current selection may be added. */
  readonly canAdd: boolean;
  readonly onPick: (next: Pick) => void;
  readonly onAdd: () => void;
}

/** Render the add-model row. */
export function AddModel(props: AddModelProps): React.ReactElement {
  const { t, groups, selectedGroup, pick, busy, readOnly, duplicate, canAdd, onPick, onAdd } =
    props;
  return (
    <div className="dsha-add">
      <span className="dsha-hint">{t("add")}</span>
      {groups.length > 0 ? (
        <select
          className="dsha-select"
          value={pick.provider}
          disabled={busy || readOnly}
          aria-label={t("provider")}
          onChange={(event) =>
            onPick({
              provider: event.target.value,
              model: "",
              limit: pick.limit,
              manualRoute: "",
            })
          }
        >
          <option value="">{t("choose")}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name ?? group.id}
            </option>
          ))}
        </select>
      ) : null}
      {groups.length > 0 ? (
        <select
          className="dsha-select"
          value={pick.model}
          disabled={busy || readOnly || selectedGroup === undefined}
          aria-label={t("model")}
          onChange={(event) => onPick({ ...pick, model: event.target.value })}
        >
          <option value="">{t("choose")}</option>
          {(selectedGroup?.models ?? []).map((model) => (
            <option key={model.id} value={model.id}>
              {model.name ?? model.id}
            </option>
          ))}
        </select>
      ) : null}
      {groups.length === 0 ? (
        <input
          className="dsha-input"
          style={{ width: 190 }}
          value={pick.manualRoute}
          placeholder={t("manual")}
          disabled={busy || readOnly}
          aria-label={t("manual")}
          onChange={(event) => onPick({ ...pick, manualRoute: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") onAdd();
          }}
        />
      ) : null}
      <input
        className="dsha-input"
        value={pick.limit}
        placeholder={t("thresholdPlaceholder")}
        disabled={busy || readOnly}
        aria-label={t("threshold")}
        onChange={(event) => onPick({ ...pick, limit: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Enter") onAdd();
        }}
      />
      <button
        type="button"
        className="dsha-button"
        disabled={busy || readOnly || !canAdd}
        onClick={onAdd}
      >
        {t("addAction")}
      </button>
      {duplicate ? <span className="dsha-hint dsha-notice-warn">{t("duplicate")}</span> : null}
    </div>
  );
}
