#!/usr/bin/env node
// The mobile gate.
//
// Adi's standing rule, 2026-08-09: every Zvuvim page has to work on a phone,
// not just be functional — kids are the actual audience and kids are on
// phones. The cheapest real break in that class is a missing viewport meta
// tag: without it a phone renders the page at a fixed desktop width and
// shrinks the whole thing to fit, which is exactly what shipped on the grade
// page (PR #9) until this gate existed to catch it.
//
// This checks one thing, mechanically: every shipped HTML page declares
// <meta name="viewport" content="width=device-width...">. It does not check
// touch-target size, layout, or whether the page reads well small — that is
// Noam's half (whether it lands), not something a script can judge.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWPORT = /<meta\s+name=["']viewport["']\s+content=["'][^"']*width=device-width/i;

const errors = [];

for (const rel of walk(ROOT)) {
  if (!rel.endsWith('.html')) continue;
  const text = readFileSync(resolve(ROOT, rel), 'utf8');
  if (!VIEWPORT.test(text)) {
    errors.push(`${rel}: no <meta name="viewport" content="width=device-width..."> — this page renders desktop-zoomed on a phone.`);
  }
}

if (errors.length) {
  console.error('Mobile gate FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nEvery Zvuvim page has to work on a phone. Add the viewport tag.');
  process.exit(1);
}

console.log('Mobile gate passed: every shipped page declares width=device-width.');

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
