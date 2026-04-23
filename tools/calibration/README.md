# Calibration Backup

This folder stores the manual map calibration data outside `public/`, so it is kept in the repo but not shipped to end users.

Current production calibration points are in [points.json](./points.json).

Coordinate format:
- `lat`, `lng`: Google Maps coordinates
- `mx`, `my`: percentage coordinates on `public/map.jpg`

The runtime app uses the same 4 points embedded in `public/index.html` for the `Где я` feature.
