#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "public", "tiles");
const BOUNDS_FILE = path.join(__dirname, "..", "data", "tile-crop-bounds.json");

function tileLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / (2 ** z);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function tileBBox(z, x, y) {
  const scale = 2 ** z;
  const west = (x / scale) * 360 - 180;
  const east = ((x + 1) / scale) * 360 - 180;
  const north = tileLat(y, z);
  const south = tileLat(y + 1, z);
  return { north, south, west, east };
}

function intersects(a, b) {
  if (a.east < b.west) return false;
  if (a.west > b.east) return false;
  if (a.north < b.south) return false;
  if (a.south > b.north) return false;
  return true;
}

function listJpgFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const name of fs.readdirSync(cur)) {
      const full = path.join(cur, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (name.toLowerCase().endsWith(".jpg")) out.push(full);
    }
  }
  return out;
}

function parseTilePath(filePath) {
  const rel = path.relative(ROOT, filePath).split(path.sep);
  if (rel.length !== 3) return null;
  const z = Number(rel[0]);
  const x = Number(rel[1]);
  const y = Number(rel[2].replace(/\.jpg$/i, ""));
  if (![z, x, y].every(Number.isFinite)) return null;
  return { z, x, y };
}

function run() {
  if (!fs.existsSync(BOUNDS_FILE)) {
    throw new Error(`Bounds file missing: ${BOUNDS_FILE}`);
  }
  const raw = JSON.parse(fs.readFileSync(BOUNDS_FILE, "utf8"));
  if (!raw || !raw.bounds) {
    throw new Error(`Invalid bounds file: ${BOUNDS_FILE}`);
  }
  const bounds = raw.bounds;
  if (![bounds.north, bounds.south, bounds.west, bounds.east].every(Number.isFinite)) {
    throw new Error(`Bounds should contain numeric north/south/west/east`);
  }

  const files = listJpgFiles(ROOT);
  let keep = 0;
  let remove = 0;
  const toRemove = [];

  for (const file of files) {
    const tile = parseTilePath(file);
    if (!tile) continue;
    const box = tileBBox(tile.z, tile.x, tile.y);
    if (intersects(box, bounds)) {
      keep += 1;
    } else {
      remove += 1;
      toRemove.push(file);
    }
  }

  for (const file of toRemove) fs.unlinkSync(file);

  console.log(`Bounds: N=${bounds.north}, S=${bounds.south}, W=${bounds.west}, E=${bounds.east}`);
  console.log(`Tiles kept: ${keep}`);
  console.log(`Tiles removed: ${remove}`);
}

run();
