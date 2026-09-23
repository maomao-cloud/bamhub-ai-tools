import fs from 'node:fs/promises';
import path from 'node:path';

import { scanTarget, error, linkFingerprint, sameIdentity, normalizeRelative, normalizeIdentity, targetPath, validateCatalogSkills } from './links.mjs';

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function catalogIdentity(catalog) {
  if (catalog.identity) return normalizeIdentity(catalog.identity, { catalog: true });
  if (catalog.catalogIdentity) return normalizeIdentity(catalog.catalogIdentity, { catalog: true });
  const canonicalPath = await fs.realpath(catalog.root);
  const stat = await fs.stat(canonicalPath);
  return normalizeIdentity({ path: path.resolve(catalog.root), canonicalPath, dev: stat.dev, ino: stat.ino, ...(catalog.gitRemote ? { gitRemote: catalog.gitRemote } : {}), ...(catalog.gitCommit ? { gitCommit: catalog.gitCommit } : {}) }, { catalog: true });
}

function manifestFor(options, target) {
  const source = options?.manifestByTarget ?? options?.manifests;
  const normalized = normalizeIdentity(target);
  const keys = [normalized.canonicalPath, normalized.path, target?.realPath, target?.canonicalPath, target?.path].filter(Boolean);
  if (source instanceof Map) return keys.map((key) => source.get(key)).find(Boolean);
  if (source && typeof source === 'object') return keys.map((key) => source[key]).find(Boolean);
  return options?.manifest;
}

function desiredInput(desiredSelections, options) {
  if (options?.disableAll) return [];
  if (!Array.isArray(desiredSelections)) throw error('DESIRED_STATE_REQUIRED', 'Desired state must be supplied explicitly');
  return desiredSelections;
}

function selectionKey(selection) {
  return `${selection.sourceRelative ?? selection.relativeSource}\0${selection.linkName ?? selection.name}`;
}

function validateSelections(selections, catalog, validSkills) {
  const bySource = new Map((catalog.skills ?? []).map((skill) => [skill.relativeSource, skill]));
  const validBySource = new Map(validSkills.map((skill) => [skill.relativeSource, skill]));
  const result = [];
  const aliases = new Set();
  const selectors = new Set();
  for (const selection of selections) {
    const sourceRelative = selection.sourceRelative ?? selection.relativeSource;
    const skill = bySource.get(sourceRelative);
    if (!skill || (selection.name && selection.name !== skill.name)) throw error('SELECTOR_NOT_FOUND', `Skill selector not found: ${sourceRelative}`);
    if (!validBySource.has(sourceRelative)) throw error('INVALID_CATALOG_SKILL', `Catalog skill source is invalid: ${sourceRelative}`);
    const linkName = selection.linkName ?? skill.name;
    if (!KEBAB_CASE.test(linkName)) throw error('INVALID_LINK_NAME', `Link name must be kebab-case: ${linkName}`);
    const key = selectionKey({ ...selection, sourceRelative, linkName });
    if (selectors.has(key)) throw error('DUPLICATE_SELECTOR', `Duplicate selector: ${key}`);
    selectors.add(key);
    if (aliases.has(linkName)) throw error('ALIAS_COLLISION', `Link alias collision: ${linkName}`);
    aliases.add(linkName);
    result.push({
      name: skill.name,
      sourceRelative,
      linkName,
      sourceDir: skill.sourceDir,
      sourceIdentity: skill.sourceIdentity,
    });
  }
  return result.sort((a, b) => a.linkName.localeCompare(b.linkName));
}

async function manifestMatches(manifest, target, catalog) {
  if (!manifest) return true;
  const expectedTarget = normalizeIdentity({ ...target, path: targetPath(target) });
  const targetMatches = sameIdentity(normalizeIdentity(manifest.target), expectedTarget, ['path', 'canonicalPath', 'dev', 'ino']);
  const expectedCatalog = await catalogIdentity(catalog);
  const catalogMatches = !expectedCatalog || sameIdentity(normalizeIdentity(manifest.catalog, { catalog: true }), normalizeIdentity(expectedCatalog, { catalog: true }), ['path', 'canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit']);
  if (!targetMatches) throw error('MANIFEST_TARGET_MISMATCH', 'Manifest target identity does not match target');
  if (!catalogMatches) throw error('MANIFEST_CATALOG_MISMATCH', 'Manifest catalog identity does not match catalog');
  return true;
}

async function planFor({ target, catalog, desired, states, catalogIdentityValue }) {
  const resolvedTarget = normalizeIdentity({ ...target, path: targetPath(target) });
  const create = [];
  const remove = [];
  const keep = [];
  const conflicts = [];
  const protectedEntries = [];
  const byPath = new Map(states.map((state) => [state.linkPath, state]));
  const desiredByName = new Map(desired.map((item) => [item.linkName, item]));

  for (const item of desired) {
    const linkPath = path.join(resolvedTarget.path, item.linkName);
    const current = byPath.get(linkPath);
    const expectedRelativeTarget = normalizeRelative(path.relative(resolvedTarget.path, item.sourceDir));
    if (!current) {
      create.push({ linkPath, sourceDir: item.sourceDir, relativeTarget: expectedRelativeTarget, sourceIdentity: item.sourceIdentity });
    } else if (current.kind === 'managed-valid' && current.realTarget === await fs.realpath(item.sourceDir)) {
      keep.push({ linkPath, relativeTarget: expectedRelativeTarget });
    } else if (current.kind === 'managed-valid' && current.manifestEntry?.sourceRelative === item.sourceRelative) {
      conflicts.push({ linkPath, kind: current.kind, reason: 'managed link target changed' });
    } else {
      conflicts.push({ linkPath, kind: current.kind, reason: 'desired link path is protected or occupied' });
    }
  }

  for (const state of states) {
    if (!['managed-valid', 'managed-broken'].includes(state.kind)) {
      if (state.kind !== 'target-missing') protectedEntries.push({ linkPath: state.linkPath, kind: state.kind, reason: state.reason });
      continue;
    }
    const entry = state.manifestEntry;
    if (!entry || !desiredByName.has(entry.linkName)) {
      remove.push({ linkPath: state.linkPath, relativeTarget: entry?.relativeTarget, manifestEntry: entry });
    }
  }

  return {
    target: resolvedTarget,
    catalog: catalogIdentityValue,
    desired,
    create: create.sort((a, b) => a.linkPath.localeCompare(b.linkPath)),
    remove: remove.sort((a, b) => a.linkPath.localeCompare(b.linkPath)),
    keep: keep.sort((a, b) => a.linkPath.localeCompare(b.linkPath)),
    conflicts: conflicts.sort((a, b) => a.linkPath.localeCompare(b.linkPath)),
    protected: protectedEntries.sort((a, b) => a.linkPath.localeCompare(b.linkPath)),
  };
}

export async function buildPlanSet({ targets, catalog, desiredSelections, options = {} } = {}) {
  if (!Array.isArray(targets)) throw error('TARGETS_REQUIRED', 'Targets must be supplied');
  const validSkills = await validateCatalogSkills(catalog);
  const desired = validateSelections(desiredInput(desiredSelections, options), catalog, validSkills);
  const plans = [];
  const protectedAll = [];
  const conflictsAll = [];
  const catalogIdentityValue = await catalogIdentity(catalog);
  for (const target of targets) {
    const manifest = manifestFor(options, target);
    await manifestMatches(manifest, target, { ...catalog, identity: catalogIdentityValue });
    const states = await scanTarget({ targetIdentity: target, catalog: { ...catalog, identity: catalogIdentityValue }, manifest });
    const plan = await planFor({ target, catalog, desired, states, catalogIdentityValue });
    plan.fingerprint = linkFingerprint({ target: plan.target, catalog: plan.catalog, desired: plan.desired, create: plan.create, remove: plan.remove, keep: plan.keep, conflicts: plan.conflicts, protected: plan.protected });
    plans.push(plan);
    protectedAll.push(...plan.protected);
    conflictsAll.push(...plan.conflicts);
  }
  return { plans, protected: protectedAll, conflicts: conflictsAll };
}
