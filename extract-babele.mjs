#!/usr/bin/env node
import { ClassicLevel } from 'classic-level';
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_MODULES = [
  'pf2e-team-plus-tian-xia',
  'pf2e-team-plus-barbarians',
  'pf2e-team-plus-inventors',
  'pf2e-team-plus-magic',
  'pf2e-team-plus-wizards',
  'pf2e-team-plus-oracles-remastered',
  'pf2e-team-plus-feats',
  'pf2e-summoners-plus',
  'clerics-remaster',
  'witches-remaster',
];

const SUPPORTED_PACK_TYPES = new Set(['Item', 'JournalEntry']);

const AUDIT_PATHS = [
  ['system', 'publication', 'title'],
  ['system', 'access'],
  ['system', 'trigger', 'value'],
  ['system', 'requirements', 'value'],
  ['system', 'frequency', 'value'],
];

function parseArgs(argv) {
  const args = {
    'modules-root': '/root/fvtt14-data/Data/modules',
    'temp-dir': '/root/fvtt14-data/Data/temp',
    'out-dir': './output/zh-CN',
    modules: DEFAULT_MODULES.join(','),
    'no-merge': false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-merge') {
      args['no-merge'] = true;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      args[key] = val;
      i++;
    }
  }
  args.modules = args.modules.split(',').map(s => s.trim()).filter(Boolean);
  return args;
}

function getPath(obj, parts) {
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function looksEnglish(s) {
  if (typeof s !== 'string') return false;
  if (s.length < 6) return false;
  if (/[一-鿿]/.test(s)) return false;
  return /[A-Za-z]/.test(s) && /\s/.test(s);
}

async function readPack(packPath) {
  const folders = [];
  const items = [];
  const journalEntries = new Map();
  const journalPages = [];
  const db = new ClassicLevel(packPath, { valueEncoding: 'json', keyEncoding: 'utf8' });
  try {
    await db.open();
  } catch (err) {
    if (String(err).includes('LOCK')) {
      throw new Error(`LevelDB locked at ${packPath} — is Foundry running?`);
    }
    throw err;
  }
  try {
    for await (const [key, value] of db.iterator()) {
      if (/^!folders!([^.!]+)$/.test(key)) {
        folders.push(value);
      } else if (/^!items!([^.!]+)$/.test(key)) {
        items.push(value);
      } else if (/^!journal!([^.!]+)$/.test(key)) {
        journalEntries.set(value._id, { ...value, pages: [] });
      } else if (/^!journal\.pages!([^.!]+)\.([^.!]+)$/.test(key)) {
        const [, parentId] = key.match(/^!journal\.pages!([^.!]+)\.([^.!]+)$/);
        journalPages.push({ parentId, page: value });
      }
    }
  } finally {
    await db.close();
  }
  for (const { parentId, page } of journalPages) {
    const parent = journalEntries.get(parentId);
    if (parent) {
      parent.pages.push(page);
    } else {
      console.error(`  [warn] orphan page ${page.name} (parent ${parentId} not found)`);
    }
  }
  return { folders, items, journals: [...journalEntries.values()] };
}

function uniqueKeyMap(docs) {
  const seen = new Map();
  const result = [];
  for (const doc of docs) {
    let key = doc.name;
    if (seen.has(key)) {
      const suffix = (doc._id || '').slice(-4);
      key = `${doc.name} (${suffix})`;
      console.error(`  [warn] duplicate name "${doc.name}" — using "${key}"`);
    }
    seen.set(key, true);
    result.push({ key, doc });
  }
  return result;
}

function buildItemEntry(doc, auditCollector) {
  const entry = {
    name: doc.name,
    description: doc.system?.description?.value ?? '',
  };
  const prereqs = doc.system?.prerequisites?.value;
  if (Array.isArray(prereqs) && prereqs.length > 0) {
    entry.prerequisites = prereqs.map(p => ({ value: p?.value ?? '' }));
  }
  for (const audPath of AUDIT_PATHS) {
    const v = getPath(doc, audPath);
    if (looksEnglish(v)) {
      const k = audPath.join('.');
      auditCollector[k] = (auditCollector[k] || 0) + 1;
    }
  }
  return entry;
}

function buildItemPack(packLabel, packData) {
  const folderMap = {};
  for (const f of packData.folders) {
    if (!(f.name in folderMap)) folderMap[f.name] = f.name;
  }
  const entries = {};
  const audit = {};
  for (const { key, doc } of uniqueKeyMap(packData.items)) {
    entries[key] = buildItemEntry(doc, audit);
  }
  const out = {
    label: packLabel,
    mapping: {
      prerequisites: {
        path: 'system.prerequisites.value',
        converter: 'structured',
        cardinality: 'many',
        mapping: { value: 'value' },
      },
    },
    folders: folderMap,
    entries,
  };
  return { out, audit };
}

const HOMEBREW_KEYS = [
  'baseWeapons',
  'weaponTraits',
  'featTraits',
  'equipmentTraits',
  'spellTraits',
  'creatureTraits',
  'languages',
  'damageTypes',
];

function extractHomebrew(manifest) {
  const flags = manifest?.flags?.[manifest.id];
  const homebrew = flags?.['pf2e-homebrew'];
  if (!homebrew || typeof homebrew !== 'object') return null;
  const out = {};
  for (const k of HOMEBREW_KEYS) {
    if (homebrew[k] && typeof homebrew[k] === 'object' && Object.keys(homebrew[k]).length > 0) {
      out[k] = homebrew[k];
    }
  }
  for (const [k, v] of Object.entries(homebrew)) {
    if (!HOMEBREW_KEYS.includes(k) && v && typeof v === 'object' && Object.keys(v).length > 0) {
      out[k] = v;
      console.error(`  [homebrew] unknown key "${k}" in ${manifest.id} — included anyway`);
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function buildJournalPack(packLabel, packData) {
  const folderMap = {};
  for (const f of packData.folders) {
    if (!(f.name in folderMap)) folderMap[f.name] = f.name;
  }
  const entries = {};
  for (const { key, doc } of uniqueKeyMap(packData.journals)) {
    const pages = {};
    const seenPages = new Map();
    for (const page of doc.pages || []) {
      let pageKey = page.name;
      if (seenPages.has(pageKey)) {
        pageKey = `${page.name} (${(page._id || '').slice(-4)})`;
      }
      seenPages.set(pageKey, true);
      pages[pageKey] = {
        name: page.name,
        text: page.text?.content ?? '',
      };
    }
    entries[key] = { name: doc.name, pages };
  }
  return {
    out: { label: packLabel, folders: folderMap, entries },
    audit: {},
  };
}

function mergeItemPriors(newDoc, priorDoc) {
  if (!priorDoc?.entries) return;
  for (const [key, newEntry] of Object.entries(newDoc.entries)) {
    const priorEntry = priorDoc.entries[key];
    if (!priorEntry) continue;
    if (priorEntry.name && priorEntry.name !== newEntry.name) {
      newEntry.name = priorEntry.name;
    }
    if (priorEntry.description) {
      newEntry.description = priorEntry.description;
    }
    if (Array.isArray(priorEntry.prerequisites) && Array.isArray(newEntry.prerequisites)) {
      if (priorEntry.prerequisites.length === newEntry.prerequisites.length) {
        newEntry.prerequisites = priorEntry.prerequisites.map(p => ({ value: p?.value ?? '' }));
      } else {
        console.error(`  [warn] prerequisite count changed for "${key}" — keeping new English values`);
      }
    }
  }
  if (priorDoc.folders) {
    for (const [k, v] of Object.entries(priorDoc.folders)) {
      if (k in newDoc.folders && v && v !== k) newDoc.folders[k] = v;
    }
  }
}

function mergeJournalPriors(newDoc, priorDoc) {
  if (!priorDoc?.entries) return;
  for (const [key, newEntry] of Object.entries(newDoc.entries)) {
    const priorEntry = priorDoc.entries[key];
    if (!priorEntry) continue;
    if (priorEntry.name && priorEntry.name !== newEntry.name) {
      newEntry.name = priorEntry.name;
    }
    if (priorEntry.pages) {
      for (const [pk, newPage] of Object.entries(newEntry.pages)) {
        const priorPage = priorEntry.pages[pk];
        if (!priorPage) continue;
        if (priorPage.name) newPage.name = priorPage.name;
        if (priorPage.text) newPage.text = priorPage.text;
      }
    }
  }
  if (priorDoc.folders) {
    for (const [k, v] of Object.entries(priorDoc.folders)) {
      if (k in newDoc.folders && v && v !== k) newDoc.folders[k] = v;
    }
  }
}

const PRIOR_ALIAS = {
  'pf2e-team-plus-feats': {
    moduleAlias: 'pf2e-feats-plus',
    packAlias: {
      'pf2e-player-options': 'player-options',
      'pf2e-misc': 'misc',
    },
  },
};

async function loadPriorTranslation(tempDir, moduleId, packName) {
  const candidates = [{ m: moduleId, p: packName }];
  const alias = PRIOR_ALIAS[moduleId];
  if (alias) {
    const aliasedPack = alias.packAlias?.[packName] ?? packName;
    candidates.push({ m: alias.moduleAlias, p: aliasedPack });
  }
  for (const { m, p } of candidates) {
    const file = path.join(tempDir, `${m}.${p}.json`);
    if (!existsSync(file)) continue;
    try {
      const doc = JSON.parse(await readFile(file, 'utf8'));
      if (m !== moduleId || p !== packName) {
        console.log(`  [alias] ${moduleId}.${packName} ← ${m}.${p}.json (renamed)`);
      }
      return doc;
    } catch (err) {
      console.error(`  [warn] could not parse prior file ${file}: ${err.message}`);
    }
  }
  return null;
}

async function processModule(moduleId, args) {
  const moduleDir = path.join(args['modules-root'], moduleId);
  const manifestPath = path.join(moduleDir, 'module.json');
  if (!existsSync(manifestPath)) {
    console.error(`[skip] module ${moduleId}: no module.json`);
    return { written: 0, skipped: 0 };
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const packs = manifest.packs || [];
  let written = 0, skipped = 0;
  console.log(`\n=== ${moduleId} (v${manifest.version}) ===`);
  for (const pack of packs) {
    if (!SUPPORTED_PACK_TYPES.has(pack.type)) {
      console.log(`  [skip] ${pack.name} (type=${pack.type})`);
      skipped++;
      continue;
    }
    const packPath = path.join(moduleDir, pack.path);
    if (!existsSync(packPath)) {
      console.log(`  [skip] ${pack.name} (path missing: ${packPath})`);
      skipped++;
      continue;
    }
    let data;
    try {
      data = await readPack(packPath);
    } catch (err) {
      console.error(`  [error] ${pack.name}: ${err.message}`);
      skipped++;
      continue;
    }
    const docCount = pack.type === 'Item' ? data.items.length : data.journals.length;
    if (docCount === 0) {
      console.log(`  [skip] ${pack.name} (empty)`);
      skipped++;
      continue;
    }
    const builder = pack.type === 'Item' ? buildItemPack : buildJournalPack;
    const { out, audit } = builder(pack.label, data);
    if (!args['no-merge']) {
      const prior = await loadPriorTranslation(args['temp-dir'], moduleId, pack.name);
      if (prior) {
        const merger = pack.type === 'Item' ? mergeItemPriors : mergeJournalPriors;
        merger(out, prior);
        console.log(`  [merge] ${pack.name} ← ${moduleId}.${pack.name}.json`);
      }
    }
    const outPath = path.join(args['out-dir'], `${moduleId}.${pack.name}.json`);
    await writeFile(outPath, JSON.stringify(out, null, 4) + '\n', 'utf8');
    written++;
    const auditMsg = Object.keys(audit).length
      ? ` [audit: ${Object.entries(audit).map(([k, n]) => `${k}×${n}`).join(', ')}]`
      : '';
    console.log(`  [write] ${pack.name} (${docCount} docs)${auditMsg}`);
  }
  const homebrew = extractHomebrew(manifest);
  if (homebrew) {
    const out = {
      moduleId,
      moduleTitle: manifest.title || moduleId,
      homebrew,
    };
    const homebrewDir = path.resolve(args['out-dir'], '..', 'homebrew');
    await mkdir(homebrewDir, { recursive: true });
    const outPath = path.join(homebrewDir, `${moduleId}.homebrew.json`);
    await writeFile(outPath, JSON.stringify(out, null, 4) + '\n', 'utf8');
    written++;
    const counts = Object.entries(homebrew).map(([k, v]) => `${k}×${Object.keys(v).length}`).join(', ');
    console.log(`  [homebrew] ../homebrew/${moduleId}.homebrew.json (${counts})`);
  }
  return { written, skipped };
}

async function main() {
  const args = parseArgs(process.argv);
  await mkdir(args['out-dir'], { recursive: true });
  console.log(`Modules root: ${args['modules-root']}`);
  console.log(`Output:       ${args['out-dir']}`);
  console.log(`Prior temp:   ${args['no-merge'] ? '(no-merge: priors ignored)' : args['temp-dir']}`);
  console.log(`Modules:      ${args.modules.length}`);
  let totalWritten = 0, totalSkipped = 0;
  for (const moduleId of args.modules) {
    const { written, skipped } = await processModule(moduleId, args);
    totalWritten += written;
    totalSkipped += skipped;
  }
  console.log(`\n=== Done: ${totalWritten} files written, ${totalSkipped} skipped ===`);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
