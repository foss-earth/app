/**
 * The controller visit: Quest 2, Quest 3, and Quest Pro. Snap turn, trigger,
 * grip, and thumbstick. The controllerless visit is headset-controllerless.mjs
 * and is not run from here.
 *
 * `ctx` is the page the shared check has already entered: both eyes drawn and
 * the head returned to level.
 */

/** The photograph-settled wait the controller visit already used. */
const LIMITS_CONDITION = 30000;

export async function controllerVisit(ctx) {
  const { record, probe, headset, waitFor, poll, screenshot, evaluate, press, report } = ctx;

  const spaceBefore = await probe('spaceForward');
  await headset('stick', 'right', 1, 0);
  await probe('afterFrames', 5);
  await headset('stick', 'right', 0, 0);
  await probe('afterFrames', 5);
  const spaceAfter = await probe('spaceForward');
  const snap = await evaluate(`window.__headsetProbe.angleDeg(${JSON.stringify(spaceBefore)}, ${JSON.stringify(spaceAfter)})`);
  record('The thumbstick turns 30°, once per push', Math.abs(snap - 30) < 1, { turnDeg: snap });
  await headset('stick', 'right', -1, 0);
  await probe('afterFrames', 5);
  await headset('stick', 'right', 0, 0);
  await probe('afterFrames', 5);
  record('Each controller has a pointer', await probe('lasers') >= 1, { lasers: await probe('lasers') });

  // A link shows in the headset where the scene says which way it lies: a
  // photograph without one is noted, and the grip goes back for the next.
  report.withoutHeadsetLinks = [];
  let photograph, links;
  for (let attempt = 0; ; attempt++) {
    photograph = await waitFor('A photograph on the map is in reach of the controller', () => probe('findPhotograph', report.withoutHeadsetLinks), Boolean);
    if (attempt === 0) record('A photograph on the map is in reach of the controller', true, photograph);
    await headset('aim', 'right', photograph.local);
    await probe('afterFrames', 5);
    await press('trigger');
    const entered = await waitFor('The trigger opens the photograph it points at', () => probe('state'), value => value.status?.active === photograph.id && value.status.phase === 'immersive');
    if (attempt === 0) record('The trigger opens the photograph it points at', true, entered.status);
    links = (await poll(() => probe('links'), value => value.length >= 1, 5000)).value;
    if (links.length) break;
    report.withoutHeadsetLinks.push(photograph.id);
    console.log(`     ${photograph.id} has no link the headset can show; trying another`);
    if (attempt === 4) record('The photograph\'s links float around the headset', false, { withoutHeadsetLinks: report.withoutHeadsetLinks });
    await press('squeeze');
    await waitFor('The grip goes back to the map', () => probe('state'), value => value.status?.active === null && value.status.phase === 'overview');
    await probe('afterFrames', 10);
  }
  record('The photograph\'s links float around the headset', true, { photograph: photograph.id, links });
  const photo = await waitFor('Both eyes show the photograph', () => probe('pixels'), value => value.left.spread > 12 && value.right.spread > 12 && value.eyeDifference < 12);
  report.photographSettled = await probe('settled', LIMITS_CONDITION);
  await probe('afterFrames', 10);
  record('Both eyes show the photograph', true, { ...photo, settled: report.photographSettled });
  await screenshot('3-photograph-in-vr');

  await headset('aim', 'right', links[0].local);
  const hovered = await waitFor('Pointing at a link marks it', () => probe('links'), value => value.find(link => link.id === links[0].id)?.scale > 1.2);
  record('Pointing at a link marks it', true, hovered);
  await press('trigger');
  const followed = await waitFor('The trigger follows the link', () => probe('state'), value => value.status?.active && value.status.active !== photograph.id && value.status.phase === 'immersive');
  record('The trigger follows the link', true, followed.status);

  await press('squeeze');
  const back = await waitFor('The grip goes back to the map', () => probe('state'), value => value.status?.active === null && value.status.phase === 'overview');
  record('The grip goes back to the map', true, back.status);

  // The page's interface: each panel a part of the page, pointed at and
  // pressed as a mouse would be.
  const ui = await waitFor('The toolbar shows below the view, a "+" at its left end', () => headset('state'),
    value => value.revision > 0 && value.panels.some(panel => panel.id === 'plus') && value.panels.some(panel => panel.kind === 'toolbar'));
  const plus = ui.panels.find(panel => panel.id === 'plus'), bar = ui.panels.filter(panel => panel.kind === 'toolbar');
  /** How far `to` is from `from` along `axis`. */
  const along = (from, to, axis) => (to[0] - from[0]) * axis[0] + (to[1] - from[1]) * axis[1] + (to[2] - from[2]) * axis[2];
  record('The toolbar shows below the view, a "+" at its left end', plus.pose.center[1] < ui.head.position[1] - 0.1
    && bar.every(part => along(plus.pose.center, part.pose.center, plus.pose.right) > 0 && part.pose.center[1] < ui.head.position[1] - 0.1),
    { head: ui.head, plus: plus.pose.center, toolbar: bar.map(part => ({ id: part.id, source: part.source, center: part.pose.center })) });

  await headset('tap', { panel: 'plus' });
  const menu = await waitFor('The "+" opens the window menu', () => evaluate(`(() => ({ items: [...document.querySelectorAll('.foss-earth-window-menu-item')].map(item => item.textContent.trim()), panels: window.__fossEarthHeadset.state().panels.filter(panel => panel.kind === 'popup').map(panel => panel.id) }))()`),
    value => value.items.length > 0 && value.panels.length > 0);
  record('The "+" opens the window menu', true, menu);
  // Sky's settings run longer than a window, for the thumbstick to scroll.
  const choice = menu.items.includes('Sky') ? 'Sky' : menu.items[0];
  await evaluate(`[...document.querySelectorAll('.foss-earth-window-menu-item')].find(item => item.textContent.trim() === ${JSON.stringify(choice)}).setAttribute('data-headset-check', '')`);
  const windowsBefore = new Set(ui.panels.filter(panel => panel.kind === 'window').map(panel => panel.id));
  await headset('tap', '[data-headset-check]');
  const opened = await waitFor('Choosing a window opens it beside the view', () => headset('state'),
    value => value.panels.some(panel => panel.kind === 'window' && !windowsBefore.has(panel.id)) && !value.panels.some(panel => panel.kind === 'popup'));
  const shown = opened.panels.find(panel => panel.kind === 'window' && !windowsBefore.has(panel.id));
  const [fx, , fz] = opened.head.forward, level = Math.hypot(fx, fz) || 1;
  record('Choosing a window opens it beside the view', Math.abs(along(opened.head.position, shown.pose.center, [-fz / level, 0, fx / level])) > 0.1,
    { window: choice, id: shown.id, source: shown.source, center: shown.pose.center });

  const body = `document.querySelector('.foss-earth-dock-panel[data-side=${shown.side}] .foss-earth-dock-panel-body')`;
  const scrolled = () => evaluate(`(() => { const body = ${body}; return { top: body?.scrollTop ?? null, height: body?.scrollHeight ?? null, shown: body?.clientHeight ?? null, revision: window.__fossEarthHeadset.state().revision }; })()`);
  const unscrolled = await scrolled();
  await headset('aim', 'right', { panel: shown.id, u: 0.5, v: 0.6 });
  await headset('scroll', 'right', 1, 20);
  const scroll = await waitFor('The thumbstick scrolls the window pointed at', scrolled, value => value.top > unscrolled.top && value.revision > unscrolled.revision);
  const popups = (await headset('state')).panels.filter(panel => panel.kind === 'popup').map(panel => ({ id: panel.id, source: panel.source, center: panel.pose.center }));
  record('The thumbstick scrolls the window pointed at', true, { before: unscrolled, after: scroll, popups });
  await screenshot('5-interface-in-vr');

  // Where the window stands, seen from the eye; the grip takes it 20° up and away, then back.
  const [ex, ey, ez] = opened.head.position, [cx, cy, cz] = shown.pose.center;
  const rightDeg = Math.atan2(cx - ex, -(cz - ez)) * 180 / Math.PI, upDeg = Math.atan2(cy - ey, Math.hypot(cx - ex, cz - ez)) * 180 / Math.PI;
  const away = await headset('move', shown.id, rightDeg + (shown.side === 'left' ? 15 : -15), upDeg + 20);
  const floated = away.panels.find(panel => panel.id === shown.id);
  record('The grip floats a window', floated?.floating === true, { center: floated?.pose.center });
  await screenshot('6-floating-window-in-vr');
  const home = await headset('move', shown.id, rightDeg, upDeg);
  const docked = home.panels.find(panel => panel.id === shown.id);
  record('Let go near its place, it goes back', docked?.floating === false, { center: docked?.pose.center, place: shown.pose.center });

  const theme = () => evaluate('document.documentElement.dataset.theme ?? null');
  if (await evaluate(`Boolean(document.querySelector('.theme-button'))`)) {
    const was = await theme();
    await headset('tap', '.theme-button');
    const now = await waitFor('A toolbar button presses from the headset', theme, value => value !== was);
    record('A toolbar button presses from the headset', true, { theme: [was, now] });
    await headset('tap', '.theme-button');
  } else console.log('     The page has no theme button on its toolbar to press');
}
