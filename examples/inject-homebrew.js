/**
 * Inject homebrew trait/weapon translations into CONFIG.PF2E at runtime.
 *
 * Why this is needed: PF2e modules register custom weapon traits, feat
 * traits, base weapons, etc. via `flags.<moduleId>.pf2e-homebrew` in
 * `module.json`. The PF2e system reads these on the `i18nInit` hook and
 * writes them to `CONFIG.PF2E.{weaponTraits,featTraits,...}` and
 * `CONFIG.PF2E.traitsDescriptions`. Babele only translates compendium
 * documents — it never sees these flags. So we have to overwrite the
 * CONFIG entries ourselves, on a hook that fires *after* the PF2e system
 * registers them. `setup` is the safe choice.
 *
 * Usage:
 *   1. Drop the homebrew/*.homebrew.json files (from the
 *      compendium-extractor output) into your translation module under
 *      `modules/<your-cn-module-id>/homebrew/`.
 *   2. Translate each `label` and `description` field in those JSONs to
 *      Chinese (leave `description` values that look like
 *      "PF2E.TraitDescriptionXxx" untouched — those are system i18n keys
 *      that babele/system handles).
 *   3. Import this file from your module's main esmodule, and set
 *      MODULE_ID below to your translation module's id.
 *   4. Reload Foundry. Homebrew traits will show up translated.
 */

// Set to your translation module's id (the module that ships the homebrew/ dir).
const MODULE_ID = 'pf2e-compendium-extra-cn';

// PF2e's special-case CONFIG record names — most flag keys map 1:1 to
// CONFIG.PF2E.<key> but two are renamed.
const CONFIG_KEY_MAP = {
  baseWeapons: 'baseWeaponTypes',
  baseArmors: 'baseArmorTypes',
};

// Mirrors PF2e's TRAIT_PROPAGATIONS table — when a trait is registered
// under one record key, the system also writes it to these other records.
// Verified against pf2e.mjs in PF2e v6+.
const TRAIT_PROPAGATIONS = {
  actionTraits: ['effectTraits'],
  classTraits: ['featTraits', 'spellTraits'],
  creatureTraits: ['ancestryTraits', 'hazardTraits'],
};

function applyHomebrewTranslations(homebrewJson, sourceModuleId) {
  const homebrew = homebrewJson?.homebrew;
  if (!homebrew || !CONFIG?.PF2E) return 0;

  let applied = 0;
  for (const [recordKey, entries] of Object.entries(homebrew)) {
    const configKey = CONFIG_KEY_MAP[recordKey] ?? recordKey;
    const target = CONFIG.PF2E[configKey];
    if (!target) {
      console.warn(`[${MODULE_ID}] CONFIG.PF2E.${configKey} not found (from ${sourceModuleId}.${recordKey}) — skipping`);
      continue;
    }
    const propagations = TRAIT_PROPAGATIONS[recordKey] ?? [];

    for (const [id, value] of Object.entries(entries)) {
      // Each entry is either a bare string label (baseWeapons) or
      // { label, description } (most trait records).
      const label = typeof value === 'string' ? value : value?.label;
      const description = typeof value === 'object' ? value?.description : undefined;

      if (label && target[id] !== undefined) {
        target[id] = label;
        applied++;
      }
      // Propagate label to mirror records that PF2e populated too.
      for (const propKey of propagations) {
        const mirror = CONFIG.PF2E[propKey];
        if (label && mirror && mirror[id] !== undefined) mirror[id] = label;
      }
      // Description: skip system i18n keys (e.g. "PF2E.TraitDescriptionModular")
      // — those are already localized via the regular lang path.
      if (description && !description.startsWith('PF2E.')) {
        CONFIG.PF2E.traitsDescriptions ??= {};
        CONFIG.PF2E.traitsDescriptions[id] = description;
      }
    }
  }
  return applied;
}

Hooks.once('setup', async () => {
  const baseUrl = `modules/${MODULE_ID}/homebrew/`;
  let totalApplied = 0;
  let totalModules = 0;

  for (const [modId, mod] of game.modules.entries()) {
    if (!mod.active) continue;
    const flags = mod.flags?.[modId];
    if (!flags?.['pf2e-homebrew']) continue;

    try {
      const response = await fetch(`${baseUrl}${modId}.homebrew.json`);
      if (!response.ok) continue; // No translation file for this module — that's fine.
      const json = await response.json();
      const applied = applyHomebrewTranslations(json, modId);
      if (applied > 0) {
        totalApplied += applied;
        totalModules++;
      }
    } catch (err) {
      console.warn(`[${MODULE_ID}] could not load homebrew translation for ${modId}:`, err);
    }
  }
  console.log(`[${MODULE_ID}] applied ${totalApplied} homebrew trait translations from ${totalModules} modules`);
});
