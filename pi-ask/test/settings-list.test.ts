import assert from "node:assert/strict";
import { test } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { DEFAULT_ASK_CONFIG } from "../src/config/defaults.ts";
import type { AskConfig } from "../src/config/schema.ts";
import type { AskConfigNotice } from "../src/config/store.ts";
import { AskSettingsList } from "../src/ui/settings-list.ts";

const savedConfig: AskConfig = {
  answer: {
    ...DEFAULT_ASK_CONFIG.answer,
  },
  behaviour: {
    autoSubmitWhenAnsweredWithoutNotes: false,
    confirmDismissWhenDirty: true,
    doublePressReviewShortcuts: true,
    presentSingleAsMulti: false,
    showFooterHints: true,
  },
  keymaps: DEFAULT_ASK_CONFIG.keymaps,
  notifications: {
    channels: ["bell"],
    enabled: true,
  },
};

function plainTheme() {
  return {
    bg(_color: string, text: string) {
      return text;
    },
    fg(_color: string, text: string) {
      return text;
    },
  };
}

function createList(
  options: {
    notice?: AskConfigNotice;
    onClose?: () => void;
    onSave?: (config: AskConfig) => Promise<AskConfig>;
    savedConfig?: AskConfig;
  } = {},
) {
  const onClose =
    options.onClose ??
    (() => {
      // test callback intentionally unused
    });
  return new AskSettingsList(plainTheme(), {
    configPath: "/tmp/eko24ive-pi-ask.json",
    notice: options.notice,
    onClose,
    onSave: options.onSave ?? ((config) => Promise.resolve(config)),
    savedConfig: options.savedConfig ?? savedConfig,
    tui: {
      requestRender() {
        // no-op in tests
      },
    },
  });
}

test("settings list stays within narrow render width", () => {
  const list = createList();
  const lines = list.render(28);

  assert(lines.every((line) => visibleWidth(line) <= 28));
  const text = lines.join("\n");
  assert(text.includes("/tmp/eko24ive-pi-ask"));
  assert(text.includes("n"));
});

test("settings list shows save failures and reverts the toggle", async () => {
  const list = createList({
    onSave: () => Promise.reject(new Error("disk nope")),
  });

  list.handleInput(" ");
  await new Promise((resolve) => setImmediate(resolve));

  const text = list.render(72).join("\n");
  assert(text.includes("disk nope"));
  assert(text.includes("Auto-submit when answered without notes"));
  assert(text.includes("[off]"));
});

test("settings list uses configured navigation and close keys", async () => {
  let saved: AskConfig | undefined;
  const customConfig: AskConfig = {
    ...savedConfig,
    keymaps: {
      ...savedConfig.keymaps,
      settingsModal: {
        ...savedConfig.keymaps.settingsModal,
        nextOption: ["j"],
        previousOption: ["k"],
        toggle: ["x"],
        close: ["q"],
      },
    },
  };
  const list = createList({
    onSave: (config) => {
      saved = config;
      return Promise.resolve(config);
    },
    savedConfig: customConfig,
  });

  list.handleInput("j");
  list.handleInput("x");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(saved?.behaviour.confirmDismissWhenDirty, false);
});

test("settings list resets config to defaults after double press", async () => {
  let saveCount = 0;
  let saved: AskConfig | undefined;
  const customConfig: AskConfig = {
    ...savedConfig,
    behaviour: {
      ...savedConfig.behaviour,
      autoSubmitWhenAnsweredWithoutNotes: true,
      showFooterHints: false,
    },
    notifications: {
      ...savedConfig.notifications,
      enabled: false,
    },
  };
  const list = createList({
    onSave: (config) => {
      saveCount += 1;
      saved = config;
      return Promise.resolve(config);
    },
    savedConfig: customConfig,
  });

  list.handleInput("\x1b[A");
  list.handleInput(" ");
  assert.equal(saveCount, 0);
  assert(list.render(72).join("\n").includes("[confirm reset]"));

  list.handleInput(" ");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(saveCount, 1);
  assert.deepEqual(saved, DEFAULT_ASK_CONFIG);
});
