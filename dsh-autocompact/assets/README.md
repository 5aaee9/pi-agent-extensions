# Screenshots

`../screenshots.json` declares these images so that community storefronts (the
plug-in market inside DSH, and the site behind it) show author-curated shots on
this plugin's card, in this order, instead of guessing from the README.

| File                       | What it shows                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `settings-autocompact.png` | **Settings → Autocompact**: the master switch, one `provider/model` row per route with its threshold, and the add-model row.              |
| `composer-status-pill.png` | This plugin's own entry in the composer's ambient row — `168K / 300K`, the measured pressure over the threshold that triggers compaction. |

Both are captures of the Chinese UI. The card is the same in either locale, so
replacing them with English captures later is a push here and nothing else.

## How the declaration is read

- The declaration lives **beside `package.json`** (`screenshots.json`), because
  this plugin is a subdirectory of a monorepo. It is deliberately **outside the
  package's `files` allowlist**: it is repository metadata for storefronts, not
  a published artefact, so it never enters the npm tarball.
- Paths are resolved **relative to `screenshots.json`**, against this repository
  at `HEAD`. They may not start with `/` or contain `..`, and there may be
  between 1 and 8 of them.
- Absolute URLs are also accepted, but only `https` on GitHub hosting
  (`raw.githubusercontent.com`, `user-images.githubusercontent.com`,
  `camo.githubusercontent.com`, `github.com` attachments); third-party image
  hosts are rejected.
- An image that 404s is dropped from the published data at the next nightly
  probe — it degrades the card, it does not fail a build. Renaming a file here
  is therefore visible in this repository, which is the point of relative paths.
