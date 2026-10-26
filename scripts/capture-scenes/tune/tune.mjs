// The tuner page: drives the FOSS Earth app in the frame with the capture's own
// planning (lib/plan.mjs) and page functions (lib/page.mjs), so the view here is
// framed exactly as a capture frames it.
import { planCamera } from "./lib/plan.mjs";
import { hideInterface, hideSceneMeshes, placeCamera, probe, setSetting } from "./lib/page.mjs";

const RAD = Math.PI / 180;
const PLACES = {
  "Mississippi River beside UMN": { latDeg: 44.974516, lonDeg: -93.2375 },
  "New York": { latDeg: 40.7128, lonDeg: -74.006 },
  "São Paulo": { latDeg: -23.5505, lonDeg: -46.6333 },
  "Washington": { latDeg: 38.9072, lonDeg: -77.0369 },
  "London": { latDeg: 51.5074, lonDeg: -0.1278 },
  "Paris": { latDeg: 48.8566, lonDeg: 2.3522 },
  "Tokyo": { latDeg: 35.6762, lonDeg: 139.6503 },
};

const params = new URLSearchParams(location.search);
const name = params.get("scenario") ?? "sky-sunset-orbit";
const loaded = await fetch(`/tune/state?scenario=${encodeURIComponent(name)}`).then(response => response.json());
if (loaded.error) {
  document.getElementById("status").innerHTML = `<span class="bad">${escape(loaded.error)}</span>`;
  throw new Error(loaded.error);
}
// The frame shows the whole view at the picture's size; a crop is drawn over it. The size the capture renders
// at for a crop (image.render, image.cropPx) is worked out again from image.crop when it runs.
for (const part of ["render", "cropPx"]) { delete loaded.scenario.image[part]; delete loaded.fileScenario.image[part]; }
// The file as it is, to compare with: the page may start from it with the command line's overrides.
const original = structuredClone(loaded.fileScenario);
const scenario = structuredClone(loaded.scenario);
const { width, height } = scenario.image;
const frame = document.getElementById("app");
const view = document.getElementById("view");
const overlay = document.getElementById("overlay");
const statusLine = document.getElementById("status");
const overlays = { centre: true, flareLine: true, edge: false, reference: true, text: true, textShare: 0.45 };
let zoom = Math.min(1, 640 / (width / devicePixelRatio));
let lastPlan = null, lastState = null, planError = null;

function escape(value) {
  return String(value).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}
const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const dayOf = utcMs => new Date(utcMs).toISOString().slice(0, 10);
const hoursOf = utcMs => (utcMs - Date.parse(`${dayOf(utcMs)}T00:00:00Z`)) / 3_600_000;

// The app, as the capture opens it, plus the settings handle (?panoramaTest=1) for live changes.
function appAddress() {
  const p = new URLSearchParams({ bench: "1", panoramaTest: "1", mapSource: scenario.scenery.basemap });
  if (scenario.scenery.renderer !== "auto") p.set("renderer", scenario.scenery.renderer);
  p.set("set.sky.time.mode", "fixed");
  p.set("set.sky.time.date", dayOf(scenario.time.utcMs));
  p.set("set.sky.time.utcHours", String(hoursOf(scenario.time.utcMs)));
  p.set("set.camera.fieldOfView", String(scenario.camera.verticalFovDeg));
  for (const [id, value] of Object.entries(scenario.settings)) p.set(`set.${id}`, String(value));
  if (scenario.scenery.basemap === "google") p.set("key", loaded.appParameters.key);
  return `/app/?${p}`;
}

// The frame is the picture's size in device pixels, as the capture renders it; zoom only scales it on screen.
function layout() {
  const cssWidth = width / devicePixelRatio, cssHeight = height / devicePixelRatio;
  frame.style.width = `${cssWidth}px`;
  frame.style.height = `${cssHeight}px`;
  frame.style.transform = `scale(${zoom})`;
  view.style.width = `${cssWidth * zoom}px`;
  view.style.height = `${cssHeight * zoom}px`;
  overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
}

/** Runs one of lib/page.mjs's functions inside the app's frame, as the capture runs it in its page. */
function inApp(fn, arg) {
  return frame.contentWindow.eval(`(${fn.toString()})(${JSON.stringify(arg ?? null)})`);
}
function applySetting(id, value) {
  scenario.settings[id] = value;
  try { inApp(setSetting, { id, value }); } catch { /* the app is still starting; the address carries it on a reload */ }
  changed();
}
/** The compass bearing from the reference place to the planned eye. */
function bearingFromReference(plan) {
  const ref = scenario.reference;
  if (!plan || !ref) return 0;
  const p1 = ref.latDeg * RAD, p2 = plan.observer.latDeg * RAD, dl = (plan.observer.lonDeg - ref.lonDeg) * RAD;
  return (Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / RAD + 360) % 360;
}
/**
 * Replaces each part of the framing that follows the Sun with the value it has now, so a new time
 * moves only the Sun: a Sun height becomes a distance, a direction from the Sun a bearing, and a
 * heading towards the Sun a compass heading. Returns what it replaced.
 */
function pinToSun() {
  const plan = lastPlan, pinned = [];
  if (!plan) return pinned;
  const fromRef = scenario.observer.fromReference;
  if (fromRef && typeof fromRef.bearingDeg !== "number") {
    pinned.push(`direction "${fromRef.bearingDeg}" → bearing ${round(bearingFromReference(plan), 2)}°`);
    fromRef.bearingDeg = round(bearingFromReference(plan), 2);
  }
  if (fromRef && typeof fromRef.distanceKm !== "number") {
    pinned.push(`Sun ${fromRef.sunAboveLimbDeg}° above the edge → ${round(plan.observer.distanceFromReferenceKm, 1)} km from ${scenario.reference.label}`);
    fromRef.distanceKm = round(plan.observer.distanceFromReferenceKm, 1);
    delete fromRef.sunAboveLimbDeg;
  }
  if (scenario.camera.headingDeg === "sun") {
    const compass = round(((plan.headingDeg - scenario.camera.headingOffsetDeg) % 360 + 360) % 360, 2);
    pinned.push(`heading towards the Sun → compass ${compass}°`);
    scenario.camera.headingDeg = compass;
  }
  return pinned;
}
let timeMoves = "sun";
let pinNote = null;
function setTime(utcMs) {
  if (timeMoves === "sun") {
    const pinned = pinToSun();
    if (pinned.length) { pinNote.textContent = `So the time moves only the Sun, these now stay put: ${pinned.join("; ")}.`; }
  }
  scenario.time.utcMs = utcMs;
  scenario.time.utc = new Date(utcMs).toISOString().replace(/\.000Z$/, "Z");
  scenario.time.label = null;
  try {
    inApp(setSetting, { id: "sky.time.date", value: dayOf(utcMs) });
    inApp(setSetting, { id: "sky.time.utcHours", value: hoursOf(utcMs) });
  } catch { /* starting */ }
  changed();
}

// --- The loop: keep the app's camera where the scenario puts it, and show what it shows.
function tick() {
  let state;
  try {
    state = inApp(probe);
  } catch {
    statusLine.textContent = "The app is loading…";
    return;
  }
  lastState = state;
  if (state.phase !== "running" || !state.sky) { statusLine.textContent = "The app is starting…"; return; }
  try {
    inApp(hideInterface, { keepAttribution: scenario.attribution });
    inApp(hideSceneMeshes, { prefixes: scenario.hideSceneMeshes });
  } catch { /* the next tick tries again */ }
  try {
    lastPlan = planCamera(scenario, state.sky.sunDirection);
    planError = null;
  } catch (error) {
    planError = error.message;
  }
  if (lastPlan && !planError) {
    const e = lastPlan.engine, c = state.camera;
    const off = !c || Math.hypot(c.center[0] - e.center[0], c.center[1] - e.center[1], c.center[2] - e.center[2]) > 0.5
      || Math.abs(Math.atan2(Math.sin(c.yaw - e.yaw), Math.cos(c.yaw - e.yaw))) > 1e-6 || Math.abs(c.pitch - e.pitch) > 1e-6
      || Math.abs(c.radius - e.radius) > 1e-3 || Math.abs(c.fov - e.fov) > 1e-6;
    if (off) { try { inApp(placeCamera, e); } catch { /* next tick */ } }
  }
  drawOverlay();
  showStatus();
}

/** The part of the view the picture keeps, in the frame's pixels: all of it without a crop. */
function kept() {
  const crop = scenario.image.crop;
  return crop ? { x: crop.left * width, y: crop.top * height, w: crop.size * width, h: crop.size * height } : { x: 0, y: 0, w: width, h: height };
}

function drawOverlay() {
  const parts = [];
  const plan = lastPlan;
  const cx = width / 2, cy = height / 2;
  const area = kept();
  if (scenario.image.crop) {
    parts.push(`<path d="M0 0H${width}V${height}H0Z M${area.x} ${area.y}h${area.w}v${area.h}h${-area.w}Z" fill="rgba(0,0,0,0.65)" fill-rule="evenodd"/>`);
    parts.push(`<rect x="${area.x}" y="${area.y}" width="${area.w}" height="${area.h}" fill="none" stroke="#fff" stroke-width="3"/>`);
  }
  if (overlays.text) {
    // The card's text, over the bottom of the picture: of the crop, when there is one.
    const top = area.y + area.h * (1 - overlays.textShare), pad = area.w * 0.06, line = area.h * 0.018, left = area.x + pad;
    parts.push(`<rect x="${area.x}" y="${top}" width="${area.w}" height="${area.y + area.h - top}" fill="rgba(0,0,0,0.25)" stroke="rgba(255,255,255,0.35)" stroke-dasharray="12 8" stroke-width="2"/>`);
    parts.push(`<text x="${left}" y="${top + pad}" fill="rgba(255,255,255,0.85)" font-size="${line * 1.1}" font-family="system-ui">06 / SKY &amp; ASTRONOMY</text>`);
    parts.push(`<text x="${left}" y="${top + pad + line * 3.2}" fill="#fff" font-size="${line * 2.4}" font-weight="600" font-family="system-ui">Card heading</text>`);
    for (let i = 0; i < 3; i++) parts.push(`<rect x="${left}" y="${top + pad + line * (5 + i * 1.9)}" width="${(area.w - 2 * pad) * (i === 2 ? 0.6 : 1)}" height="${line * 0.9}" rx="${line * 0.3}" fill="rgba(255,255,255,0.35)"/>`);
  }
  if (overlays.centre) parts.push(`<path d="M${cx - 24} ${cy}h48M${cx} ${cy - 24}v48" stroke="rgba(255,255,255,0.6)" stroke-width="2"/>`);
  if (plan) {
    const sun = plan.expected.sun.pixel;
    if (overlays.flareLine && sun) {
      // The ghosts lie on the line from the Sun through the picture's centre.
      const dx = cx - sun.x, dy = cy - sun.y, k = 3;
      parts.push(`<line x1="${sun.x}" y1="${sun.y}" x2="${sun.x + dx * k}" y2="${sun.y + dy * k}" stroke="rgba(255,200,80,0.7)" stroke-width="2" stroke-dasharray="10 8"/>`);
      parts.push(`<circle cx="${sun.x}" cy="${sun.y}" r="14" fill="none" stroke="rgba(255,200,80,0.9)" stroke-width="3"/>`);
    }
    if (overlays.edge && plan.expected.limb?.length) {
      parts.push(`<polyline points="${plan.expected.limb.map(p => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="rgba(120,200,255,0.8)" stroke-width="2"/>`);
    }
    const ref = plan.expected.reference;
    if (overlays.reference && ref?.pixel) {
      parts.push(`<circle cx="${ref.pixel.x}" cy="${ref.pixel.y}" r="10" fill="none" stroke="#7f7" stroke-width="3"/>`);
      parts.push(`<text x="${ref.pixel.x + 16}" y="${ref.pixel.y + 6}" fill="#7f7" font-size="24" font-family="system-ui">${escape(ref.label ?? "reference")}</text>`);
    }
  }
  overlay.innerHTML = parts.join("");
}

function flareAngle(plan) {
  const sun = plan?.expected.sun.pixel;
  if (!sun) return null;
  const dx = sun.x - width / 2, dy = sun.y - height / 2;
  if (Math.hypot(dx, dy) < 1) return null;
  return Math.atan2(Math.abs(dy), Math.abs(dx)) / RAD;
}

function showStatus() {
  const s = lastState, plan = lastPlan;
  const rows = [];
  if (planError) rows.push(`<span class="bad">${escape(planError)}</span>`);
  if (plan) {
    const sun = plan.expected.sun, angle = flareAngle(plan);
    const edgeRow = plan.expected.limb?.[Math.floor(plan.expected.limb.length / 2)]?.y;
    rows.push(`<b>Sun</b> ${sun.aboveLimbDeg}° above the edge${sun.behindEarth ? " (behind the Earth)" : ""}, ${sun.pixel ? `at (${sun.pixel.x}, ${sun.pixel.y})${sun.pixel.inFrame ? "" : ", out of frame"}` : "behind the eye"}`
      + (angle !== null ? ` · <b>flare line</b> ${round(angle, 1)}° from horizontal` : ""));
    rows.push(`<b>Edge</b> at ${typeof edgeRow === "number" ? `${Math.round(edgeRow / height * 100)}% down the centre` : "out of view"} · <b>observer</b> ${plan.observer.latDeg}, ${plan.observer.lonDeg}, ${plan.observer.altitudeKm} km`
      + (plan.observer.distanceFromReferenceKm !== null ? ` (${plan.observer.distanceFromReferenceKm} km from ${escape(scenario.reference?.label ?? "the reference")})` : "")
      + ` · <b>look</b> heading ${plan.headingDeg}°, elevation ${plan.elevationDeg}°`);
  }
  if (s?.sky) {
    const flare = s.sky.lensFlare, flareSun = flare?.sources?.find(source => source.id === "sun");
    const night = s.sky.nightLights;
    const compensation = s.exposureCompensationEv ?? 0;
    rows.push(`<b>Exposure</b> EV ${round(s.sky.ev100 - compensation)}${compensation ? ` (sky EV ${round(s.sky.ev100)}, compensation ${round(compensation)})` : ""}${scenario.settings["sky.exposure.mode"] === "fixed" ? ", fixed" : `, metered EV ${round(s.sky.meteredEv100)}`}`
      + (flare ? ` · <b>lens flare</b> ${flare.mode}${flareSun && typeof flareSun.stopsOverWhite === "number" ? `, Sun ${round(flareSun.stopsOverWhite, 1)} stops over white` : ""}` : "")
      + (night ? ` · <b>night lights</b> ${night.here}/${night.needed} tiles${night.loading ? `, ${night.loading} loading` : ""}` : ""));
    const crop = scenario.image.crop;
    rows.push(`<b>Map</b> ${escape(s.status.mode)}${s.streaming ? ", tiles streaming" : ", loaded"} · canvas ${s.canvas ? `${s.canvas.width}×${s.canvas.height} px` : "?"}`
      + (crop ? ` · <b>crop</b> keeps ${round(crop.size * 100, 1)}%: the capture renders the view at ${Math.round(width / crop.size)}×${Math.round(height / crop.size)} and keeps ${width}×${height} of it` : ` (the capture is ${width}×${height})`));
  }
  statusLine.innerHTML = rows.join("<br>");
}

// --- Controls.
const panel = document.getElementById("panel");
const refreshers = [];
function section(title) {
  const set = document.createElement("fieldset");
  set.innerHTML = `<legend>${escape(title)}</legend>`;
  panel.append(set);
  return set;
}
function row(parent, label, ...children) {
  const div = document.createElement("div");
  div.className = children.length === 1 ? "row wide" : "row";
  const text = document.createElement("label");
  text.textContent = label;
  div.append(text, ...children);
  parent.append(div);
  return div;
}
/** A slider and a number box bound to one value; `get` returns undefined when the control does not apply. */
function slider(parent, label, { min, max, step, get, set }) {
  const range = Object.assign(document.createElement("input"), { type: "range", min, max, step });
  const box = Object.assign(document.createElement("input"), { type: "number", step });
  const div = row(parent, label, range, box);
  const apply = value => { if (Number.isFinite(value)) { set(value); refresh(); } };
  range.addEventListener("input", () => apply(Number(range.value)));
  box.addEventListener("change", () => apply(Number(box.value)));
  refreshers.push(() => {
    const value = get();
    div.style.display = value === undefined ? "none" : "";
    if (value === undefined) return;
    if (document.activeElement !== box) box.value = String(round(value, 4));
    range.value = String(value);
  });
}
function choice(parent, label, options, { get, set }) {
  const select = document.createElement("select");
  for (const [value, text] of options) select.append(Object.assign(document.createElement("option"), { value, textContent: text }));
  const div = row(parent, label, select);
  select.addEventListener("change", () => { set(select.value); refresh(); });
  refreshers.push(() => {
    const value = get();
    div.style.display = value === undefined ? "none" : "";
    if (value !== undefined) select.value = value;
  });
  return select;
}
function refresh() { for (const update of refreshers) update(); }
function changed() { showCommand(); }

const obs = () => scenario.observer, from = () => scenario.observer.fromReference, cam = () => scenario.camera;

// Scenario.
{
  const set = section(`Scenario: ${name}`);
  choice(set, "Open another", loaded.names.map(n => [n, n]), { get: () => name, set: value => { location.search = `?scenario=${encodeURIComponent(value)}`; } });
  choice(set, "Preview zoom", [["0.5", "50%"], ["0.75", "75%"], ["1", "100%"], ["1.25", "125%"]].concat([[String(zoom), `${Math.round(zoom * 100)}% (fit)`]]), {
    get: () => String(zoom), set: value => { zoom = Number(value); layout(); } });
  row(set, "Picture", Object.assign(document.createElement("span"), { textContent: `${width} × ${height} px; the frame renders it at that size and is scaled to fit` }));
}

// Time.
{
  const set = section("Time (UTC)");
  const box = Object.assign(document.createElement("input"), { type: "text" });
  row(set, "Instant", box);
  box.addEventListener("change", () => { const ms = Date.parse(box.value); if (Number.isFinite(ms)) { setTime(ms); refresh(); } else box.classList.add("bad"); });
  refreshers.push(() => { box.classList.remove("bad"); if (document.activeElement !== box) box.value = scenario.time.utc; });
  slider(set, "Minutes from start", { min: -360, max: 360, step: 1, get: () => (scenario.time.utcMs - original.time.utcMs) / 60000, set: minutes => setTime(original.time.utcMs + minutes * 60000) });
  choice(set, "A new time moves", [["sun", "Only the Sun (the eye and the look stay)"], ["view", "The eye and the look too (they follow the Sun)"]], {
    get: () => timeMoves, set: value => { timeMoves = value; } });
  pinNote = Object.assign(document.createElement("div"), { className: "hint" });
  set.append(pinNote);
}

// Reference place and observer.
{
  const set = section("Observer");
  const names = Object.keys(PLACES);
  const ownLabel = original.reference?.label;
  choice(set, "Reference place", [...(ownLabel && !PLACES[ownLabel] ? [[ownLabel, `${ownLabel} (scenario's)`]] : []), ...names.map(n => [n, n]), ["custom", "Custom…"]], {
    get: () => scenario.reference ? (PLACES[scenario.reference.label] || scenario.reference.label === ownLabel ? scenario.reference.label : "custom") : undefined,
    set: value => {
      if (value === "custom") { scenario.reference.label = "Custom place"; }
      else if (value === ownLabel) scenario.reference = structuredClone(original.reference);
      else scenario.reference = { label: value, ...PLACES[value] };
      changed();
    },
  });
  slider(set, "Reference latitude", { min: -90, max: 90, step: 0.0001, get: () => scenario.reference?.latDeg, set: v => { scenario.reference.latDeg = v; changed(); } });
  slider(set, "Reference longitude", { min: -180, max: 180, step: 0.0001, get: () => scenario.reference?.lonDeg, set: v => { scenario.reference.lonDeg = v; changed(); } });

  choice(set, "Place the eye", [["sun", "From the reference: Sun height above the edge"], ["distance", "From the reference: distance"], ["fixed", "At a latitude and longitude"]], {
    get: () => !from() ? "fixed" : typeof from().distanceKm === "number" ? "distance" : "sun",
    set: value => {
      const plan = lastPlan;
      if (value === "fixed") {
        scenario.observer = { latDeg: plan?.observer.latDeg ?? 0, lonDeg: plan?.observer.lonDeg ?? 0, altitudeKm: obs().altitudeKm };
      } else {
        const base = from() ?? { bearingDeg: "away-from-sun" };
        if (value === "distance") scenario.observer.fromReference = { bearingDeg: base.bearingDeg, distanceKm: plan?.observer.distanceFromReferenceKm ?? 1000 };
        else scenario.observer.fromReference = { bearingDeg: base.bearingDeg, sunAboveLimbDeg: plan?.expected.sun.aboveLimbDeg ?? 2 };
        if (!scenario.reference) scenario.reference = { label: "New York", ...PLACES["New York"] };
        delete scenario.observer.latDeg; delete scenario.observer.lonDeg;
      }
      changed();
    },
  });
  choice(set, "Direction from it", [["away-from-sun", "Away from the Sun"], ["towards-sun", "Towards the Sun"], ["degrees", "A bearing (below)"]], {
    get: () => !from() ? undefined : typeof from().bearingDeg === "number" ? "degrees" : from().bearingDeg,
    set: value => {
      if (value === "degrees") {
        // Start from the bearing the named direction gives now.
        from().bearingDeg = round(bearingFromReference(lastPlan), 2);
      } else from().bearingDeg = value;
      changed();
    },
  });
  slider(set, "Bearing (°)", { min: 0, max: 360, step: 0.5, get: () => (from() && typeof from().bearingDeg === "number" ? from().bearingDeg : undefined), set: v => { from().bearingDeg = v; changed(); } });
  slider(set, "Sun above the edge (°)", { min: -10, max: 30, step: 0.1, get: () => (from() && typeof from().sunAboveLimbDeg === "number" ? from().sunAboveLimbDeg : undefined), set: v => { from().sunAboveLimbDeg = v; changed(); } });
  slider(set, "Distance (km)", { min: 0, max: 5000, step: 5, get: () => (from() && typeof from().distanceKm === "number" ? from().distanceKm : undefined), set: v => { from().distanceKm = v; changed(); } });
  slider(set, "Eye latitude", { min: -90, max: 90, step: 0.01, get: () => (!from() ? obs().latDeg : undefined), set: v => { obs().latDeg = v; changed(); } });
  slider(set, "Eye longitude", { min: -180, max: 180, step: 0.01, get: () => (!from() ? obs().lonDeg : undefined), set: v => { obs().lonDeg = v; changed(); } });
  slider(set, "Altitude (km)", { min: 100, max: 3000, step: 5, get: () => obs().altitudeKm, set: v => { obs().altitudeKm = v; changed(); } });
}

// Camera.
{
  const set = section("Camera");
  choice(set, "Heading", [["sun", "Towards the Sun, plus the offset"], ["degrees", "A compass heading, plus the offset"]], {
    get: () => (cam().headingDeg === "sun" ? "sun" : "degrees"),
    set: value => { cam().headingDeg = value === "sun" ? "sun" : round(((lastPlan?.headingDeg ?? 0) - cam().headingOffsetDeg + 360) % 360, 2); changed(); },
  });
  slider(set, "Compass heading (°)", { min: 0, max: 360, step: 0.5, get: () => (cam().headingDeg === "sun" ? undefined : cam().headingDeg), set: v => { cam().headingDeg = v; changed(); } });
  slider(set, "Heading offset (°)", { min: -90, max: 90, step: 0.5, get: () => cam().headingOffsetDeg, set: v => { cam().headingOffsetDeg = v; changed(); } });
  choice(set, "Tilt", [["limb", "Put the Earth's edge at a height"], ["elevation", "Look down by an angle"]], {
    get: () => (cam().limbAtY !== undefined ? "limb" : "elevation"),
    set: value => {
      if (value === "limb") { cam().limbAtY = 0.3; delete cam().elevationDeg; }
      else { cam().elevationDeg = lastPlan?.elevationDeg ?? -30; delete cam().limbAtY; }
      changed();
    },
  });
  slider(set, "Edge height (from top)", { min: 0, max: 1, step: 0.005, get: () => cam().limbAtY, set: v => { cam().limbAtY = v; changed(); } });
  slider(set, "Look down (°)", { min: -89, max: -1, step: 0.1, get: () => cam().elevationDeg, set: v => { cam().elevationDeg = v; changed(); } });
  slider(set, "Field of view (°)", { min: 10, max: 120, step: 0.5, get: () => cam().verticalFovDeg, set: v => {
    cam().verticalFovDeg = v;
    try { inApp(setSetting, { id: "camera.fieldOfView", value: v }); } catch { /* starting */ }
    changed();
  } });
}

// Crop: a part of the view at the picture's shape, kept at the picture's full size.
{
  const set = section("Crop");
  const crop = () => scenario.image.crop;
  const smallest = Math.ceil(Math.max(width, height) / 4096 * 1000) / 1000;
  const clamp = () => {
    const c = crop();
    c.left = round(Math.min(Math.max(c.left, 0), 1 - c.size), 4);
    c.top = round(Math.min(Math.max(c.top, 0), 1 - c.size), 4);
  };
  const box = Object.assign(document.createElement("input"), { type: "checkbox" });
  box.style.justifySelf = "start";
  row(set, "Crop the picture", box);
  box.addEventListener("change", () => {
    if (box.checked) scenario.image.crop = { left: 0.075, top: 0.075, size: 0.85 };
    else delete scenario.image.crop;
    refresh(); drawOverlay(); changed();
  });
  refreshers.push(() => { box.checked = Boolean(crop()); });
  // Size keeps the crop's centre where it is.
  slider(set, "Size (share kept)", { min: smallest, max: 1, step: 0.005, get: () => crop()?.size, set: v => {
    const c = crop(), middleX = c.left + c.size / 2, middleY = c.top + c.size / 2;
    c.size = v; c.left = middleX - v / 2; c.top = middleY - v / 2; clamp(); drawOverlay(); changed();
  } });
  slider(set, "Left", { min: 0, max: 1, step: 0.0025, get: () => crop()?.left, set: v => { crop().left = v; clamp(); drawOverlay(); changed(); } });
  slider(set, "Top", { min: 0, max: 1, step: 0.0025, get: () => crop()?.top, set: v => { crop().top = v; clamp(); drawOverlay(); changed(); } });
  set.append(Object.assign(document.createElement("div"), { className: "hint",
    textContent: "Drag the picture to move the crop. The capture renders the view larger, so the crop is still the full picture size, not enlarged." }));

  // Dragging the view moves the crop.
  let drag = null;
  overlay.style.pointerEvents = "auto";
  overlay.addEventListener("pointerdown", event => {
    if (!crop()) return;
    drag = { x: event.clientX, y: event.clientY, left: crop().left, top: crop().top, box: view.getBoundingClientRect() };
    overlay.setPointerCapture(event.pointerId);
  });
  overlay.addEventListener("pointermove", event => {
    overlay.style.cursor = crop() ? "move" : "";
    if (!drag || !crop()) return;
    crop().left = drag.left + (event.clientX - drag.x) / drag.box.width;
    crop().top = drag.top + (event.clientY - drag.y) / drag.box.height;
    clamp(); refresh(); drawOverlay(); changed();
  });
  for (const type of ["pointerup", "pointercancel"]) overlay.addEventListener(type, () => { drag = null; });
}

// Exposure.
{
  const set = section("Exposure");
  const setting = id => scenario.settings[id];
  choice(set, "Mode", [["metered", "Metered (the meter picks the EV)"], ["fixed", "Fixed EV"]], {
    get: () => setting("sky.exposure.mode") ?? "metered", set: value => applySetting("sky.exposure.mode", value) });
  slider(set, "Fixed EV (lower is brighter)", { min: -12, max: 20, step: 0.1, get: () => (setting("sky.exposure.mode") === "fixed" ? setting("sky.exposure.ev100") ?? 9.7 : undefined), set: v => applySetting("sky.exposure.ev100", v) });
  slider(set, "Compensation (stops, + brighter)", { min: -8, max: 8, step: 0.1, get: () => setting("renderer.exposureEV") ?? 0, set: v => applySetting("renderer.exposureEV", v) });
  choice(set, "Lens flare", [["off", "Off"], ["glare", "Glare"], ["flare", "Flare (with ghosts)"]], {
    get: () => setting("sky.exposure.lensFlare") ?? "off", set: value => applySetting("sky.exposure.lensFlare", value) });
}

// Overlays.
{
  const set = section("Guides (not in the picture)");
  const check = (label, keyName) => {
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: overlays[keyName] });
    box.style.justifySelf = "start";
    box.addEventListener("change", () => { overlays[keyName] = box.checked; drawOverlay(); });
    row(set, label, box);
  };
  check("Card text area", "text");
  slider(set, "Text area height", { min: 0.1, max: 0.8, step: 0.01, get: () => overlays.textShare, set: v => { overlays.textShare = v; drawOverlay(); } });
  check("Flare line and Sun", "flareLine");
  check("Centre", "centre");
  check("Earth's edge (planned)", "edge");
  check("Reference place", "reference");
}

// Actions.
const command = document.createElement("pre");
const message = Object.assign(document.createElement("div"), { id: "message" });
{
  const set = section("Save and capture");
  const save = Object.assign(document.createElement("button"), { textContent: `Save to ${name}.json` });
  const newName = Object.assign(document.createElement("input"), { type: "text", placeholder: `${name}-tuned` });
  newName.style.width = "180px";
  const saveAs = Object.assign(document.createElement("button"), { textContent: "Save as new" });
  const capture = Object.assign(document.createElement("button"), { textContent: "Capture" });
  const publish = Object.assign(document.createElement("input"), { type: "checkbox", id: "publish" });
  const publishLabel = Object.assign(document.createElement("label"), { htmlFor: "publish", textContent: scenario.publish ? "and publish to the website" : "(this scenario has no publish paths)" });
  publish.disabled = !scenario.publish;
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(save, newName, saveAs);
  const actions2 = document.createElement("div");
  actions2.className = "actions";
  actions2.style.marginTop = "8px";
  actions2.append(capture, publish, publishLabel);
  set.append(actions, actions2, message, Object.assign(document.createElement("div"), { className: "hint", textContent: "The same picture from the command line, without saving:" }), command);

  const post = async (route, body) => {
    const response = await fetch(route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error ?? response.statusText);
    return result;
  };
  const busy = (on, text) => { for (const button of [save, saveAs, capture]) button.disabled = on; if (text) message.innerHTML = text; };
  save.addEventListener("click", async () => {
    busy(true, "Saving…");
    try {
      const result = await post("/tune/save", { name, scenario });
      Object.assign(original, structuredClone(scenario));
      message.innerHTML = `<span class="good">Saved ${escape(result.file)}</span><br>${result.changed.length ? escape(result.changed.join("\n")).replace(/\n/g, "<br>") : "Nothing had changed."}${result.backup ? `<br><span class="hint">The previous file is kept at ${escape(result.backup)}</span>` : ""}`;
      showCommand();
    } catch (error) { message.innerHTML = `<span class="bad">${escape(error.message)}</span>`; }
    busy(false);
  });
  saveAs.addEventListener("click", async () => {
    busy(true, "Saving…");
    try {
      const result = await post("/tune/save-as", { name, newName: newName.value.trim() || `${name}-tuned`, scenario });
      message.innerHTML = `<span class="good">Saved ${escape(result.file)}</span>`;
    } catch (error) { message.innerHTML = `<span class="bad">${escape(error.message)}</span>`; }
    busy(false);
  });
  capture.addEventListener("click", async () => {
    busy(true, `Capturing${publish.checked ? " and publishing" : ""}… (about 10 seconds; the terminal shows progress)`);
    try {
      const result = await post("/tune/capture", { name, scenario, publish: publish.checked });
      if (!result.ok) throw new Error(result.log.trim().split("\n").slice(-3).join("\n"));
      message.innerHTML = `<span class="good">Captured</span> ${escape(result.directory)}`;
      document.getElementById("result").innerHTML = `<div class="hint">The capture (${escape(result.picture)}):</div><img src="${escape(result.url)}?${Date.now()}" alt="">`
        + `<pre>${escape(result.log.split("\n").filter(line => /captured in|Sun |exposure|published|bracket/.test(line)).join("\n"))}</pre>`;
    } catch (error) { message.innerHTML = `<span class="bad">${escape(error.message)}</span>`; }
    busy(false);
  });
}

/** Each field that differs from the file as loaded, as the capture's --set overrides. */
function overrides(before, after, at = []) {
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (isObject(before) && isObject(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => overrides(before[key], after[key], [...at, key]));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  const value = after === undefined ? null : after;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return [`--set ${at[0] === "settings" ? `settings.${at.slice(1).join(".")}` : at.join(".")}=${/[\s"']/.test(text) ? `'${text}'` : text}`];
}
function showCommand() {
  const pick = s => {
    const out = structuredClone({ time: s.time, reference: s.reference, observer: s.observer, camera: s.camera, image: s.image, settings: s.settings });
    delete out.time.utcMs; delete out.time.label;
    if (out.image.crop == null) delete out.image.crop;
    return out;
  };
  const list = overrides(pick(original), pick(scenario));
  command.textContent = `cd ~/gh/foss-earth/app\nnode scripts/capture-scenes/capture.mjs ${name} --app-dist build/capture-scenes/app-dist${list.length ? ` \\\n  ${list.join(" \\\n  ")}` : ""}`;
}

layout();
frame.src = appAddress();
refresh();
showCommand();
setInterval(tick, 250);
