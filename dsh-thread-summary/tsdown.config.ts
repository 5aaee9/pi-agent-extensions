import { defineConfig } from "tsdown";
export default defineConfig({
  entry: ["src/client/index.tsx"],
  outDir: ".",
  clean: false,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  dts: false,
  deps: { neverBundle: [/^react(\/|$)/, "@deepseek-ai/dsh-client-ui-primitives"] },
  outputOptions: {
    entryFileNames: "client.js",
    banner: [
      "window.__ModuleLoader__.load({",
      '\tid: "@indexyz/dsh-thread-summary",',
      "\tfactory: (require) => {",
      "\t\tvar module = { exports: {} };",
      "\t\tvar exports = module.exports;",
    ].join("\n"),
    footer: "\t\treturn module.exports;\n\t}\n});",
  },
});
