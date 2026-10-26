// Earth geometry for placing a capture camera, in the engine's frame: WGS84
// Earth-centred, Earth-fixed metres (x through 0° 0°, z north). The engine's
// scene uses this frame directly (a right-handed scene whose camera centre is
// ECEF), so a point computed here is a point the camera can be placed at.

const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
/** The radius the engine's globe camera orbits with, metres. */
export const CAMERA_PLANET_RADIUS = 6378137;
/** Mean Earth radius, for great-circle offsets. */
const MEAN_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const norm = a => Math.hypot(a[0], a[1], a[2]);
export const unit = a => scale(a, 1 / norm(a));

export function geodeticToEcef(latDeg, lonDeg, heightM) {
  const lat = latDeg * RAD, lon = lonDeg * RAD;
  const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  return [(n + heightM) * Math.cos(lat) * Math.cos(lon), (n + heightM) * Math.cos(lat) * Math.sin(lon), (n * (1 - E2) + heightM) * Math.sin(lat)];
}

/** Bowring's closed form; well under a millimetre for any height a camera has. */
export function ecefToGeodetic([x, y, z]) {
  const b = A * (1 - F), ep2 = (A * A - b * b) / (b * b), p = Math.hypot(x, y);
  const th = Math.atan2(z * A, p * b);
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - E2 * A * Math.cos(th) ** 3);
  const n = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  return { latDeg: lat / RAD, lonDeg: Math.atan2(y, x) / RAD, heightM: p / Math.cos(lat) - n };
}

/** East, north and up (the ellipsoid's normal) at a place. */
export function enuAt(latDeg, lonDeg) {
  const lat = latDeg * RAD, lon = lonDeg * RAD;
  return {
    east: [-Math.sin(lon), Math.cos(lon), 0],
    north: [-Math.sin(lat) * Math.cos(lon), -Math.sin(lat) * Math.sin(lon), Math.cos(lat)],
    up: [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)],
  };
}

/** A direction from a heading (degrees east of north) and an elevation above the local horizontal. */
export function directionOf(enu, headingDeg, elevationDeg) {
  const h = headingDeg * RAD, e = elevationDeg * RAD;
  return unit(add(add(scale(enu.east, Math.cos(e) * Math.sin(h)), scale(enu.north, Math.cos(e) * Math.cos(h))), scale(enu.up, Math.sin(e))));
}

/** A direction's heading and elevation in a local frame. */
export function anglesOf(enu, direction) {
  const d = unit(direction);
  const headingDeg = (Math.atan2(dot(d, enu.east), dot(d, enu.north)) / RAD + 360) % 360;
  return { headingDeg, elevationDeg: Math.asin(Math.max(-1, Math.min(1, dot(d, enu.up)))) / RAD };
}

/** The place `distanceM` along the great circle leaving (lat, lon) at `bearingDeg`. */
export function destination(latDeg, lonDeg, bearingDeg, distanceM) {
  const lat = latDeg * RAD, lon = lonDeg * RAD, b = bearingDeg * RAD, d = distanceM / MEAN_RADIUS;
  const lat2 = Math.asin(Math.sin(lat) * Math.cos(d) + Math.cos(lat) * Math.sin(d) * Math.cos(b));
  const lon2 = lon + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat), Math.cos(d) - Math.sin(lat) * Math.sin(lat2));
  return { latDeg: lat2 / RAD, lonDeg: ((lon2 / RAD + 540) % 360) - 180 };
}

/** Great-circle distance, metres, and initial bearing, degrees. */
export function distanceAndBearing(from, to) {
  const la1 = from.latDeg * RAD, la2 = to.latDeg * RAD, dl = (to.lonDeg - from.lonDeg) * RAD;
  const c = Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dl);
  const bearing = Math.atan2(Math.sin(dl) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dl));
  return { distanceM: Math.acos(Math.max(-1, Math.min(1, c))) * MEAN_RADIUS, bearingDeg: (bearing / RAD + 360) % 360 };
}

/**
 * The globe camera's local frame at a point: up through the Earth's centre
 * (Babylon's GeospatialCamera assumes a sphere), east = z × up, north = up × east.
 * Its yaw is a heading from this north and its pitch is 90° plus the elevation
 * above this horizontal. Headings match the ellipsoid's; elevations differ by
 * at most 0.2° (the geocentric and geodetic verticals).
 */
export function geocentricFrame(point) {
  const up = unit(point);
  const east = unit(cross([0, 0, 1], up));
  return { east, north: cross(up, east), up };
}

/** Babylon's ComputeYawPitchFromLookAtToRef: the yaw and pitch that look along `forward` from an orbit centred at `center`. */
export function yawPitchOf(forward, center) {
  const { east, north, up } = geocentricFrame(center);
  const f = unit(forward), cosPitch = -dot(f, up);
  const pitch = Math.acos(Math.max(-1, Math.min(1, cosPitch)));
  const horizontal = add(f, scale(up, cosPitch));
  return { yaw: Math.atan2(dot(horizontal, east), dot(horizontal, north)), pitch };
}

/**
 * How far below the camera's horizontal the Earth's edge is, seen from `eye`:
 * the tangent cone of a sphere of the local radius, ignoring the air.
 */
export function limbDipDeg(eye) {
  const { latDeg, lonDeg } = ecefToGeodetic(eye);
  const radius = norm(geodeticToEcef(latDeg, lonDeg, 0));
  return Math.acos(Math.min(1, radius / norm(eye))) / RAD;
}

/**
 * The camera's frame as Babylon's globe camera builds it: looking from `eye`
 * towards `center`, level about the geocentric up at the centre, so the
 * picture has no roll.
 */
export function cameraFrame(eye, center, verticalFovDeg, width, height) {
  const forward = unit(sub(center, eye));
  const right = unit(cross(forward, unit(center)));
  const up = cross(right, forward);
  return { eye, forward, right, up, verticalFovDeg, width, height };
}

/** Where a direction falls in the picture, CSS pixels from the top left; null behind the camera. */
export function projectDirection(frame, direction) {
  const d = unit(direction), z = dot(d, frame.forward);
  if (z <= 1e-6) return null;
  const t = Math.tan((frame.verticalFovDeg * RAD) / 2), aspect = frame.width / frame.height;
  const x = dot(d, frame.right) / z / (t * aspect), y = dot(d, frame.up) / z / t;
  return { x: (frame.width / 2) * (1 + x), y: (frame.height / 2) * (1 - y) };
}

/**
 * The Earth's edge across the picture: for each sampled column, the row where
 * the sphere's tangent cone from the eye crosses it. The edge is a circle on
 * the sky; it is sampled by azimuth about the eye's vertical.
 */
export function projectLimb(frame, samples = 33) {
  const eye = frame.eye, down = scale(unit(eye), -1);
  const half = Math.PI / 2 - limbDipDeg(eye) * RAD;
  // Any direction perpendicular to the vertical, then the circle around it.
  const a = unit(cross(down, Math.abs(down[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0])), b = cross(down, a);
  const points = [];
  for (let i = 0; i < 720; i++) {
    const t = (i / 720) * 2 * Math.PI;
    const around = add(scale(a, Math.cos(t)), scale(b, Math.sin(t)));
    const p = projectDirection(frame, add(scale(down, Math.cos(half)), scale(around, Math.sin(half))));
    if (p && p.x >= 0 && p.x <= frame.width) points.push(p);
  }
  if (!points.length) return [];
  points.sort((p, q) => p.x - q.x);
  const columns = [];
  for (let s = 0; s < samples; s++) {
    const x = (s / (samples - 1)) * frame.width;
    const near = points.reduce((best, p) => (Math.abs(p.x - x) < Math.abs(best.x - x) ? p : best));
    if (Math.abs(near.x - x) < frame.width / samples) columns.push({ x: Math.round(x), y: Math.round(near.y * 10) / 10 });
  }
  return columns;
}
