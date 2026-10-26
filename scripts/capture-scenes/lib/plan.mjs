// From a scenario and the Sun's direction to the camera the engine is given,
// and what that camera should show: where the Sun and the Earth's edge fall.
import {
  add, anglesOf, cameraFrame, destination, directionOf, distanceAndBearing, dot, ecefToGeodetic, enuAt,
  geocentricFrame, geodeticToEcef, limbDipDeg, projectDirection, projectLimb, scale, yawPitchOf,
} from "./geo.mjs";

const RAD = Math.PI / 180;
/** How far in front of the eye the orbit centre is put, metres; the engine's placed views use 1 m. */
const REACH_M = 1;
const round = (value, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/** How high the Sun stands above the Earth's edge, seen from this eye, degrees. */
function sunAboveLimbDeg(eye, sunDirection) {
  return Math.asin(dot(sunDirection, geocentricFrame(eye).up)) / RAD + limbDipDeg(eye);
}

/**
 * The observer's place: given, or a great-circle offset from the reference
 * place. The offset is a distance, or is solved so that the Sun stands a given
 * height above the Earth's edge: at a fixed time, moving the observer is what
 * raises or lowers the Sun.
 */
function observerPlace(scenario, sunDirection) {
  const { observer, reference } = scenario;
  if (!observer.fromReference) return { latDeg: observer.latDeg, lonDeg: observer.lonDeg, how: "given" };
  const from = observer.fromReference;
  let bearing = from.bearingDeg;
  if (typeof bearing === "string") {
    const sunAzimuth = anglesOf(enuAt(reference.latDeg, reference.lonDeg), sunDirection).headingDeg;
    bearing = bearing === "away-from-sun" ? sunAzimuth + 180 : sunAzimuth;
  }
  bearing = ((bearing % 360) + 360) % 360;
  const altitudeM = observer.altitudeKm * 1000;
  const at = distanceM => destination(reference.latDeg, reference.lonDeg, bearing, distanceM);
  if (typeof from.distanceKm === "number") {
    return { ...at(from.distanceKm * 1000), distanceKm: from.distanceKm, how: `${from.distanceKm} km from the reference place at bearing ${round(bearing, 2)}°` };
  }
  // Bisection on the distance along the bearing, within a quarter of the globe.
  const target = from.sunAboveLimbDeg;
  const excess = distanceM => { const p = at(distanceM); return sunAboveLimbDeg(geodeticToEcef(p.latDeg, p.lonDeg, altitudeM), sunDirection) - target; };
  let low = 0, high = 10_000_000;
  const lowSign = Math.sign(excess(low));
  if (lowSign === 0) return { ...at(0), distanceKm: 0, how: `at the reference place, where the Sun is ${target}° above the Earth's edge` };
  if (Math.sign(excess(high)) === lowSign) {
    throw new Error(`No place within 10,000 km of the reference at bearing ${round(bearing, 2)}° puts the Sun ${target}° above the Earth's edge from ${observer.altitudeKm} km`);
  }
  for (let i = 0; i < 60 && high - low > 0.01; i++) {
    const middle = (low + high) / 2;
    if (Math.sign(excess(middle)) === lowSign) low = middle; else high = middle;
  }
  const distanceKm = round((low + high) / 2000, 3);
  return { ...at(distanceKm * 1000), distanceKm, how: `${distanceKm} km from the reference place at bearing ${round(bearing, 2)}°, solved so the Sun is ${target}° above the Earth's edge` };
}

/** What a camera with this eye and centre shows: the Sun's place, the Earth's edge, and where the reference place is. */
export function describeView({ eye, center, verticalFovDeg, width, height, sunDirection, reference }) {
  const frame = cameraFrame(eye, center, verticalFovDeg, width, height);
  const local = geocentricFrame(eye);
  const look = { headingDeg: (Math.atan2(dot(frame.forward, local.east), dot(frame.forward, local.north)) / RAD + 360) % 360, elevationDeg: Math.asin(dot(frame.forward, local.up)) / RAD };
  const sunHere = { headingDeg: (Math.atan2(dot(sunDirection, local.east), dot(sunDirection, local.north)) / RAD + 360) % 360, elevationDeg: Math.asin(dot(sunDirection, local.up)) / RAD };
  const dip = limbDipDeg(eye);
  const sunPixel = projectDirection(frame, sunDirection);
  const limb = projectLimb(frame, 9);
  const place = ecefToGeodetic(eye);
  let referenceView = null;
  if (reference) {
    const point = geodeticToEcef(reference.latDeg, reference.lonDeg, 0);
    const toPoint = add(point, scale(eye, -1));
    const visible = dot(toPoint, point) < 0; // facing the eye, in front of the horizon
    const pixel = projectDirection(frame, toPoint);
    const offset = distanceAndBearing({ latDeg: place.latDeg, lonDeg: place.lonDeg }, reference);
    referenceView = { label: reference.label ?? null, groundDistanceKm: round(offset.distanceM / 1000, 1), bearingDeg: round(offset.bearingDeg, 2),
      inFrontOfHorizon: visible, pixel: pixel && visible ? { x: Math.round(pixel.x), y: Math.round(pixel.y) } : null };
  }
  return {
    eye: { latDeg: round(place.latDeg, 5), lonDeg: round(place.lonDeg, 5), altitudeKm: round(place.heightM / 1000, 3) },
    look: { headingDeg: round(look.headingDeg, 3), elevationDeg: round(look.elevationDeg, 3), verticalFovDeg: round(verticalFovDeg, 3),
      horizontalFovDeg: round(2 * Math.atan(Math.tan((verticalFovDeg * RAD) / 2) * (width / height)) / RAD, 3) },
    limbDipDeg: round(dip, 3),
    // Behind the Earth once its whole disc (0.533° across) is below the edge.
    sun: { headingDeg: round(sunHere.headingDeg, 3), elevationDeg: round(sunHere.elevationDeg, 3), aboveLimbDeg: round(sunHere.elevationDeg + dip, 3),
      behindEarth: sunHere.elevationDeg + dip < -0.2665,
      pixel: sunPixel ? { x: Math.round(sunPixel.x), y: Math.round(sunPixel.y), inFrame: sunPixel.x >= 0 && sunPixel.x < width && sunPixel.y >= 0 && sunPixel.y < height } : null },
    limb,
    reference: referenceView,
  };
}

/** The camera for a scenario, with the Sun's direction from the page's sky (Earth-fixed unit vector). */
export function planCamera(scenario, sunDirection) {
  const place = observerPlace(scenario, sunDirection);
  const altitudeM = scenario.observer.altitudeKm * 1000;
  const eye = geodeticToEcef(place.latDeg, place.lonDeg, altitudeM);
  const local = geocentricFrame(eye);
  const { camera, image } = scenario;
  const sunHeading = (Math.atan2(dot(sunDirection, local.east), dot(sunDirection, local.north)) / RAD + 360) % 360;
  const headingDeg = (((camera.headingDeg === "sun" ? sunHeading : camera.headingDeg) + camera.headingOffsetDeg) % 360 + 360) % 360;
  let elevationDeg = camera.elevationDeg;
  if (camera.limbAtY !== undefined) {
    // The edge's row, as a fraction of the picture from the top, fixes the view's tilt.
    const below = Math.atan((2 * camera.limbAtY - 1) * Math.tan((camera.verticalFovDeg * RAD) / 2)) / RAD;
    elevationDeg = -limbDipDeg(eye) + below;
  }
  if (elevationDeg > -1 || elevationDeg < -89) throw new Error(`The view's elevation, ${round(elevationDeg, 2)}°, is outside the camera's tilt limits (-89° to -1°)`);
  const forward = directionOf(local, headingDeg, elevationDeg);
  const center = add(eye, scale(forward, REACH_M));
  const { yaw, pitch } = yawPitchOf(forward, center);
  return {
    observer: { latDeg: round(place.latDeg, 6), lonDeg: round(place.lonDeg, 6), altitudeKm: scenario.observer.altitudeKm, distanceFromReferenceKm: place.distanceKm ?? null, how: place.how },
    headingDeg: round(headingDeg, 4), elevationDeg: round(elevationDeg, 4),
    engine: { center, yaw, pitch, radius: REACH_M, fov: camera.verticalFovDeg * RAD },
    expected: describeView({ eye, center, verticalFovDeg: camera.verticalFovDeg, width: image.width, height: image.height, sunDirection, reference: scenario.reference }),
  };
}
