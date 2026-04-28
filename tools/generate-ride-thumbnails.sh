#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$ROOT_DIR/images"
FULL_DIR="$ROOT_DIR/public/ride-images/full"
THUMB_DIR="$ROOT_DIR/public/ride-images/thumbs"
THUMB_SIZE=320
THUMB_QUALITY=74

mkdir -p "$FULL_DIR" "$THUMB_DIR"

build_asset() {
  local src="$1"
  local slug="$2"
  local gravity="$3"
  local dx="$4"
  local dy="$5"
  local input=""

  if [[ -f "$SRC_DIR/$src" ]]; then
    input="$SRC_DIR/$src"
  elif [[ -f "$FULL_DIR/$slug.jpg" ]]; then
    input="$FULL_DIR/$slug.jpg"
  else
    echo "skip: $src not found" >&2
    return 0
  fi

  if [[ "$input" == "$SRC_DIR/$src" ]]; then
    magick "$input" \
      -auto-orient \
      -resize '1800x1800>' \
      -strip \
      -interlace Plane \
      -quality 86 \
      "$FULL_DIR/$slug.jpg"
  fi

  magick "$input" \
    -auto-orient \
    -filter Lanczos \
    -resize "${THUMB_SIZE}x${THUMB_SIZE}^" \
    -gravity "$gravity" \
    -crop "${THUMB_SIZE}x${THUMB_SIZE}${dx}${dy}" \
    +repage \
    -strip \
    -interlace Plane \
    -quality "$THUMB_QUALITY" \
    "$THUMB_DIR/$slug.jpg"
}

build_asset "Autopia.jpg" "autopia" "Center" "+0" "+24"
build_asset "Big Thunder Mountain.jpg" "big-thunder-mountain" "Center" "+54" "+0"
build_asset "pinocchio.jpg" "pinocchio" "Center" "+0" "+0"
build_asset "Buzz Lightyear Laser Blast.jpeg" "buzz-lightyear-laser-blast" "Center" "+0" "+12"
build_asset "Indiana Jones and the Temple of Peril.jpg" "indiana-jones" "Center" "-18" "+14"
build_asset "hyperspace mountain.jpg" "hyperspace-mountain" "Center" "+28" "+16"
build_asset "Orbitron.jpeg" "orbitron" "Center" "+0" "-8"
build_asset "Peter Pan's Flight.jpg" "peter-pans-flight" "East" "+0" "-24"
build_asset "Phantom Manor.jpg" "phantom-manor" "Center" "+96" "+0"
build_asset "Pirates of the Caribbean.jpg" "pirates-of-the-caribbean" "Center" "+42" "+0"
build_asset "Star Tours The Adventures Continue.jpg" "star-tours" "South" "+0" "+0"
build_asset "it's a small world.jpg" "its-a-small-world" "Center" "+18" "+0"
build_asset "Avengers Assemble.jpg" "avengers-assemble" "Center" "+0" "+0"
build_asset "Cars Road Trip.jpeg" "cars-road-trip" "Center" "+8" "+0"
build_asset "Crushs Coaster.jpeg" "crushs-coaster" "Center" "+24" "+0"
build_asset "Frozen Ever After.jpg" "frozen-ever-after" "Center" "+0" "+0"
build_asset "RC Racer.jpeg" "rc-racer" "Center" "+0" "+0"
build_asset "Ratatouille.jpg" "ratatouille" "Center" "+0" "+0"
build_asset "Spider-Man W.E.B..jpg" "spider-man-web" "Center" "+0" "+0"
build_asset "Tower of Terror.jpeg" "tower-of-terror" "Center" "+12" "+0"
build_asset "Toy Soldiers.jpg" "toy-soldiers" "Center" "+0" "+0"
