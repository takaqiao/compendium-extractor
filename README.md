# btfg-extract

Extract [babele 2.8](https://gitlab.com/riccisi/foundryvtt-babele) translation source files directly from FoundryVTT v13 / v14 LevelDB compendium packs — no Foundry instance required.

Built as a CLI alternative to [babele-translation-files-generator](https://github.com/justbreathe1/babele-translation-files-generator) (BTFG), which is UI-only inside Foundry. This script reads each pack's LevelDB the same way Foundry does (via `classic-level`) and emits one JSON per pack in the babele 2.8 mapping format used by [pf2e_compendium_chn](https://github.com/AlphaStarguide/pf2e_compendium_chn).

Designed for re-extraction when modules update: previously translated entries from an existing folder are merged in, so only new / changed strings need to be retranslated.

## What it captures

For Item packs:

```json
{
  "label": "<pack label>",
  "mapping": {
    "prerequisites": {
      "path": "system.prerequisites.value",
      "converter": "structured",
      "cardinality": "many",
      "mapping": { "value": "value" }
    }
  },
  "folders": { "<orig name>": "<orig name>" },
  "entries": {
    "<doc.name>": {
      "name": "<doc.name>",
      "description": "<system.description.value>",
      "prerequisites": [{ "value": "..." }]
    }
  }
}
```

For JournalEntry packs (no `mapping`, matching official zh-CN convention):

```json
{
  "label": "<pack label>",
  "folders": { ... },
  "entries": {
    "<entry.name>": {
      "name": "<entry.name>",
      "pages": {
        "<page.name>": { "name": "<page.name>", "text": "<page.text.content>" }
      }
    }
  }
}
```

`name` and `description` are babele defaults so they don't need to appear in `mapping`. `prerequisites` mapping is required because the structured-array converter is not a default — without it, prior extractors silently lost prerequisite text.

`Actor`, `Macro`, `RollTable`, and `Adventure` packs are skipped (with a stderr log).

## Install

```bash
git clone <this-repo>
cd btfg-extract
npm install
```

Requires Node.js ≥ 18.

## Usage

```bash
node extract-babele.mjs \
  --modules-root /path/to/Foundry/Data/modules \
  --temp-dir     /path/to/old/translations \
  --out-dir      ./output/zh-CN \
  --modules      pf2e-team-plus-tian-xia,clerics-remaster,witches-remaster
```

All flags are optional. Defaults:

| Flag | Default |
|---|---|
| `--modules-root` | `/root/fvtt14-data/Data/modules` |
| `--temp-dir` | `/root/fvtt14-data/Data/temp` |
| `--out-dir` | `./output/zh-CN` |
| `--modules` | The 10 PF2e modules listed below |

**Foundry must not be running** while extracting — Foundry holds a LevelDB `LOCK`. The script will surface a friendly error if the lock is held.

## Default module list

- `pf2e-team-plus-tian-xia` (天夏)
- `pf2e-team-plus-barbarians`
- `pf2e-team-plus-inventors`
- `pf2e-team-plus-magic`
- `pf2e-team-plus-wizards`
- `pf2e-team-plus-oracles-remastered`
- `pf2e-feats-plus`
- `pf2e-summoners-plus`
- `clerics-remaster`
- `witches-remaster`

## Prior-translation merge

If `--temp-dir` contains a file named `<moduleId>.<packName>.json`, the script merges its translated `name`, `description`, and `prerequisites` (or journal `pages[*].name`/`text`) into the new output for matching English keys. New entries that don't exist in the old file are left in English. Entries whose prerequisite count changed get an `[warn]` line on stderr and keep the new English values.

## Audit

While extracting, the script flags non-empty English-looking values at known structured paths that aren't currently mapped:

- `system.publication.title`
- `system.access`
- `system.trigger.value`
- `system.requirements.value`
- `system.frequency.value`

Output looks like `[audit: system.publication.title×329]`. If you want any of these translated, add them to the `mapping` block manually, or extend `extract-babele.mjs`. The PF2e convention so far has been to keep trigger/requirements/frequency text inside the description HTML, so these mostly stay English.

## Output

One file per pack at `<out-dir>/<moduleId>.<packName>.json`. Drop them into a babele module (`compendium/zh-CN/`) and register with:

```js
Hooks.once('babele.init', (babele) => {
  babele.register({
    module: '<your-translation-module-id>',
    lang: 'zh-CN',
    dir: 'compendium/zh-CN',
  });
});
```

## License

MIT
