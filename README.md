# compendium-extractor

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

**Actor packs** (e.g. iconic NPCs, summoned-creature aspects):
```json
{
  "label": "...",
  "mapping": { "tokenName": "prototypeToken.name", "prototypeToken": "prototypeToken.name", "blurb": "system.details.blurb", "publicNotes": "system.details.publicNotes", "items": { "path": "items", "converter": "fromPack" } },
  "entries": {
    "<actor.name>": {
      "name": "...", "tokenName": "...", "prototypeToken": "...",
      "items": { "<item.name>": { "name": "...", "description": "..." } }
    }
  }
}
```

**Macro packs**: `entries[macro.name] = { name, command }` (no `mapping`).

**RollTable packs**: `entries[table.name] = { name, description, results }` where `results` is a dict keyed by `"<low>-<high>"` (or `"<n>"` when low === high) with the result text as value.

`Adventure` packs are skipped (with a stderr log). Merge of prior translations only applies to `Item` and `JournalEntry` packs.

### Homebrew traits / weapons

Many PF2e community modules register custom weapons, weapon traits, feat traits, equipment traits, etc. via `flags.<moduleId>.pf2e-homebrew` in `module.json` rather than as compendium entries — these are loaded directly by the PF2e system and are **not visible to babele**, so prior extractions silently dropped them (e.g. the `overkill` weapon trait from Barbarians+).

For each module that declares any homebrew, the script writes `<out-dir>/../homebrew/<moduleId>.homebrew.json` (i.e. always to a sibling `homebrew/` directory regardless of which `--out-dir` you pass — the data is language-agnostic):

```json
{
  "moduleId": "pf2e-team-plus-barbarians",
  "moduleTitle": "Barbarians+",
  "homebrew": {
    "baseWeapons": { "axewheel": "Axewheel", ... },
    "weaponTraits": {
      "overkill": {
        "label": "Overkill",
        "description": "Weapons with the overkill trait..."
      }
    }
  }
}
```

This file is **not babele input** — translate it by hand (replace `label` and `description` strings) and inject the result into the PF2e system at runtime via a Foundry hook in your translation module (e.g. on `setup`, walk `CONFIG.PF2E.weaponTraits` / `traitsDescriptions` and replace English values with translated ones). Description values that look like `PF2E.TraitDescriptionXxx` are already system i18n keys — leave those alone.

Recognized homebrew categories: `baseWeapons`, `weaponTraits`, `featTraits`, `equipmentTraits`, `spellTraits`, `creatureTraits`, `languages`, `damageTypes`. Unknown keys are extracted anyway with a stderr warning.

## Install

```bash
git clone <this-repo>
cd compendium-extractor
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
| `--no-merge` | (off) — when set, skips prior-translation merge and emits raw English output |

Pass `--no-merge` to extract a clean English-only baseline (no values from `--temp-dir` are pulled in):

```bash
node extract-babele.mjs --out-dir ./output/en --no-merge
```

**Foundry must not be running** while extracting — Foundry holds a LevelDB `LOCK`. The script will surface a friendly error if the lock is held.

## Default module list

- `pf2e-team-plus-tian-xia` (天夏)
- `pf2e-team-plus-barbarians`
- `pf2e-team-plus-inventors`
- `pf2e-team-plus-magic`
- `pf2e-team-plus-wizards`
- `pf2e-team-plus-oracles-remastered`
- `pf2e-team-plus-feats` (formerly `pf2e-feats-plus`; old prior translations are auto-aliased on merge)
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
