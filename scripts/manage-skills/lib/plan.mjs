import fs from 'node:fs/promises';
import path from 'node:path';

import { scanTarget, error, linkFingerprint, sameIdentity, normalizeRelative } from './links.mjs';

async function catalogIdentity(catalog) {
  if (catalog.identity) return catalog.identity;
  if (catalog.catalogIdentity) return catalog.catalogIdentity;
  const canonicalPath = await fs.realpath(catalog.root);
  const stat = await fs.stat(canonicalPath);
  return { path: catalog.root, canonicalPath, dev: stat.dev, ino: stat.ino };
}

function targetKey(target) {
  return target.canonicalPath ?? target.realPath ?? target.path;
}

function manifestFor(options, target) {
  const source = options?.manifestByTarget ?? options?.manifests;
  if (source instanceof Map) return source.get(targetKey(target)) ?? source.get(target.path);
  if (source && typeof source === 'object') return source[targetKey(target)] ?? source[target.path];
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

function validateSelections(selections, catalog) {
  const bySource = new Map((catalog.skills ?? []).map((skill) => [skill.relativeSource, skill]));
  const result = [];
  const aliases = new Set();
  const selectors = new Set();
  for (const selection of selections) {
    const sourceRelative = selection.sourceRelative ?? selection.relativeSource;
    const skill = bySource.get(sourceRelative);
    if (!skill || (selection.name && selection.name !== skill.name)) throw error('SELECTOR_NOT_FOUND', `Skill selector not found: ${sourceRelative}`);
    const linkName = selection.linkName ?? skill.name;
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
  const targetMatches = sameIdentity(manifest.target, target);
  const expectedCatalog = await catalogIdentity(catalog);
  const catalogMatches = !expectedCatalog || sameIdentity(manifest.catalog, expectedCatalog, ['canonicalPath', 'dev', 'ino']);
  if (!targetMatches) throw error('MANIFEST_TARGET_MISMATCH', 'Manifest target identity does not match target');
  if (!catalogMatches) throw error('MANIFEST_CATALOG_MISMATCH', 'Manifest catalog identity does not match catalog');
  return true;
}

async function planFor({ target, catalog, desired, states, manifest, catalogIdentityValue }) {
  const create = [];
  const remove = [];
  const keep = [];
  const conflicts = [];
  const protectedEntries = [];
  const byPath = new Map(states.map((state) => [state.linkPath, state]));
  const desiredByName = new Map(desired.map((item) => [item.linkName, item]));

  for (const item of desired) {
    const linkPath = path.join(target.path, item.linkName);
    const current = byPath.get(linkPath);
    const expectedRelativeTarget = normalizeRelative(path.relative(target.path, item.sourceDir));
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
    target: { ...target },
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
  const desired = validateSelections(desiredInput(desiredSelections, options), catalog);
  const plans = [];
  const protectedAll = [];
  const conflictsAll = [];
  const catalogIdentityValue = await catalogIdentity(catalog);
  for (const target of targets) {
    const manifest = manifestFor(options, target);
    await manifestMatches(manifest, target, { ...catalog, identity: catalogIdentityValue });
    const states = await scanTarget({ targetIdentity: target, catalog: { ...catalog, identity: catalogIdentityValue }, manifest });
    const plan = await planFor({ target, catalog, desired, states, manifest, catalogIdentityValue });
    plan.fingerprint = linkFingerprint({ target: plan.target, catalog: plan.catalog, desired: plan.desired, create: plan.create, remove: plan.remove, keep: plan.keep, conflicts: plan.conflicts, protected: plan.protected });
    plans.push(plan);
    protectedAll.push(...plan.protected);
    conflictsAll.push(...plan.conflicts);
  }
  return { plans, protected: protectedAll, conflicts: conflictsAll };
}
