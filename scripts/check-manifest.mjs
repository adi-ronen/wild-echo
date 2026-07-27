#!/usr/bin/env node
// The provenance gate.
//
// Nothing ships unless every asset and every stated fact has a complete
// manifest row with an unexpired recheck date. This is a machine, not a habit:
// it fails the build in CI where anyone can read the log, rather than depending
// on whoever happened to look at the diff.
//
// What it does NOT do: judge whether a claim is true. It checks that a claim
// has a named source, a licence, and a date somebody verified it. Blurring
// those two would let everyone assume the other one had it.

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSET_FIELDS = ['id', 'kind', 'path', 'description', 'source', 'license', 'attribution', 'verified', 'recheck'];
const FACT_FIELDS = ['id', 'claim', 'source', 'sourceQuote', 'verified', 'recheck'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const today = process.env.MANIFEST_TODAY || new Date().toISOString().slice(0, 10);
const errors = [];

const manifest = JSON.parse(await readFile(resolve(ROOT, 'assets/manifest.json'), 'utf8'));

check(manifest.assets ?? [], ASSET_FIELDS, 'asset');
check(manifest.facts ?? [], FACT_FIELDS, 'fact');

function check(rows, fields, kind) {
  const seen = new Set();
  rows.forEach((row, i) => {
    const where = `${kind}[${i}] ${row.id ?? '(no id)'}`;
    for (const f of fields) {
      const v = row[f];
      if (v === undefined || v === null || String(v).trim() === '') {
        errors.push(`${where}: missing required field "${f}"`);
      }
    }
    if (row.id) {
      if (seen.has(row.id)) errors.push(`${where}: duplicate id`);
      seen.add(row.id);
    }
    for (const f of ['verified', 'recheck']) {
      if (row[f] && !DATE.test(row[f])) errors.push(`${where}: "${f}" must be YYYY-MM-DD, got "${row[f]}"`);
    }
    if (row.recheck && DATE.test(row.recheck) && row.recheck < today) {
      errors.push(`${where}: recheck date ${row.recheck} has passed (today is ${today}). Re-verify the source or drop the row.`);
    }
    if (row.verified && row.recheck && row.recheck <= row.verified) {
      errors.push(`${where}: recheck (${row.recheck}) must be after verified (${row.verified})`);
    }
    // A local file asset must actually exist. A row pointing at nothing is a
    // row that stops meaning anything the moment someone deletes the file.
    if (kind === 'asset' && row.path && !row.path.startsWith('http') && !existsSync(resolve(ROOT, row.path))) {
      errors.push(`${where}: path "${row.path}" does not exist in the repository`);
    }
  });
}

// Any audio committed to the repo must be claimed by a row. This is the half
// that catches the real failure mode: a file arrives and nobody writes it down.
const claimed = new Set((manifest.assets ?? []).map((a) => a.path));
const media = walk(ROOT).filter((p) => /\.(mp3|wav|ogg|m4a|webm|flac|aac)$/i.test(p));
for (const file of media) {
  if (!claimed.has(file)) errors.push(`unclaimed media file "${file}": add a manifest row or delete it`);
}

if (errors.length) {
  console.error('Provenance gate FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${errors.length} problem(s). Nothing ships until these are fixed.`);
  process.exit(1);
}

console.log(`Provenance gate passed: ${(manifest.assets ?? []).length} asset(s), ${(manifest.facts ?? []).length} fact(s), ${media.length} media file(s) all claimed.`);

// Plain recursive walk. Deliberately not node:fs globSync — that is still
// flagged experimental, and a gate that has to hold the licence floor does not
// get to depend on something that might change under it.
function walk(dir, base = '') {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(resolve(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}
