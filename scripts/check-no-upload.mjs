#!/usr/bin/env node
// The privacy gate.
//
// The consent wording on tester/index.html tells a stranger that their voice
// never leaves their device and that this page has nowhere to send it. That
// sentence is a promise made to a person, so it gets a machine behind it rather
// than a habit: this fails the build if anything in the shipped source acquires
// the ability to send data anywhere.
//
// What it forbids: sendBeacon, XMLHttpRequest, WebSocket, RTCPeerConnection,
// form submission, and any fetch() that is not a plain same-origin GET of a
// file this repository ships.
//
// It is a coarse instrument — it reads source text, it does not prove absence.
// It catches the realistic failure: somebody adds an analytics snippet or a
// convenient upload and nobody notices in the diff.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = /\.(js|html)$/;

// fetch() calls we allow: the reference audio and the tester config, both of
// them files in this repository, both of them GETs.
const ALLOWED_FETCH = [
  "fetch(ref.url)",
  "fetch('config.json')",
];

const FORBIDDEN = [
  [/navigator\.sendBeacon/, 'navigator.sendBeacon'],
  [/new\s+XMLHttpRequest/, 'XMLHttpRequest'],
  [/new\s+WebSocket/, 'WebSocket'],
  [/new\s+RTCPeerConnection/, 'RTCPeerConnection'],
  [/<form\b/i, 'a <form> element'],
  [/\.submit\s*\(/, 'form submit()'],
  [/method\s*:\s*['"](POST|PUT|PATCH)['"]/i, 'a non-GET request'],
  [/googletagmanager|google-analytics|gtag\(|plausible|segment\.io|sentry/i, 'an analytics or telemetry service'],
];

const errors = [];

for (const rel of walk(ROOT)) {
  if (!SHIPPED.test(rel)) continue;
  if (rel.startsWith('scripts/')) continue; // build tools, never served
  const text = readFileSync(resolve(ROOT, rel), 'utf8');

  for (const [re, what] of FORBIDDEN) {
    if (re.test(text)) errors.push(`${rel}: contains ${what}. Nothing shipped here may send data anywhere.`);
  }

  for (const call of text.match(/fetch\([^)]*\)/g) ?? []) {
    if (!ALLOWED_FETCH.includes(call)) {
      errors.push(`${rel}: unrecognised fetch — ${call}. If this is a legitimate same-origin GET, add it to ALLOWED_FETCH in this script, in the same commit, so the addition is visible in the diff.`);
    }
  }
}

if (errors.length) {
  console.error('Privacy gate FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  console.error('\nThe tester consent screen promises no recording leaves the device. Keep it true.');
  process.exit(1);
}

console.log('Privacy gate passed: no upload path, no telemetry, no non-GET request in shipped source.');

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
