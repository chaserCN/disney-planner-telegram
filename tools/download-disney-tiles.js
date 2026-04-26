#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");

const TILE_SIZE = 512;
const MIN_ZOOM = 15;
const MAX_ZOOM = 18;
const BASE_URL = "https://media.disneylandparis.com/mapTiles/images";

// Bounding box that covers Disneyland Paris resort area comfortably.
const BOUNDS = {
  north: 48.8785,
  south: 48.8585,
  west: 2.7615,
  east: 2.7995
};

const ROOT = path.join(__dirname, "..", "public", "tiles");
const MIN_FILE_SIZE_BYTES = 1200;

function lonToTileX(lon, z) {
  const scale = 2 ** z;
  return Math.floor(((lon + 180) / 360) * scale);
}

function latToTileY(lat, z) {
  const scale = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const mercN = Math.log(Math.tan(Math.PI / 4 + rad / 2));
  return Math.floor(((1 - mercN / Math.PI) / 2) * scale);
}

async function download(url, filePath) {
  const res = await fetch(url);
  if (!res.ok) return { ok: false, status: res.status };
  const arr = await res.arrayBuffer();
  const buf = Buffer.from(arr);
  if (buf.byteLength < MIN_FILE_SIZE_BYTES) {
    return { ok: false, status: "small" };
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, buf);
  return { ok: true, status: 200, size: buf.byteLength };
}

async function run() {
  fs.mkdirSync(ROOT, { recursive: true });
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 1) {
    const xMin = lonToTileX(BOUNDS.west, z);
    const xMax = lonToTileX(BOUNDS.east, z);
    const yMin = latToTileY(BOUNDS.north, z);
    const yMax = latToTileY(BOUNDS.south, z);
    const total = (xMax - xMin + 1) * (yMax - yMin + 1);

    console.log(`z=${z}: x ${xMin}..${xMax}, y ${yMin}..${yMax} (${total} tiles)`);

    for (let x = xMin; x <= xMax; x += 1) {
      for (let y = yMin; y <= yMax; y += 1) {
        const rel = path.join(String(z), String(x), `${y}.jpg`);
        const out = path.join(ROOT, rel);
        if (fs.existsSync(out)) {
          skipped += 1;
          continue;
        }
        const url = `${BASE_URL}/${z}/${x}/${y}.jpg`;
        try {
          const res = await download(url, out);
          if (res.ok) ok += 1;
          else if (res.status === "small" || res.status === 404) skipped += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
    }
  }

  console.log(`Done. downloaded=${ok}, skipped=${skipped}, failed=${failed}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
