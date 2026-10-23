/**
 * The controllerless visit: Vision Pro. Pinch opens a photograph, follows a
 * link, and presses the toolbar. No snap turn, grip, thumbstick, resting
 * laser, or hover-then-click. Those are the controller visit.
 *
 * `ctx` is the page the shared check has already entered: both eyes drawn and
 * the head returned to level.
 */

export async function controllerlessVisit(ctx) {
  const { record, probe, headset, waitFor, poll, screenshot, evaluate, report } = ctx;

  const modes = await evaluate(`(async () => ({ vr: await navigator.xr.isSessionSupported('immersive-vr'), ar: await navigator.xr.isSessionSupported('immersive-ar') }))()`);
  record('immersive-vr is offered and immersive-ar is not', modes.vr === true && modes.ar === false, modes);

  const resting = await headset('state');
  record('Nothing is tracked until a pinch', Array.isArray(resting.sources) && resting.sources.length === 0, resting.sources);

  // The first photograph the ray can meet has to show a link. There is no grip
  // to leave it and try another.
  const photograph = await waitFor('A photograph on the map is in reach', () => probe('findPhotograph', []), Boolean);
  record('A photograph on the map is in reach', true, photograph);
  await headset('pinch', photograph.local);
  const entered = await waitFor('A pinch opens the photograph it meets', () => probe('state'), value => value.status?.active === photograph.id && value.status.phase === 'immersive');
  record('A pinch opens the photograph it meets', true, entered.status);
  const linksResult = await poll(() => probe('links'), value => value.length >= 1, 5000);
  if (!linksResult.ok) record('The photograph\'s links float around the headset', false, { photograph: photograph.id, links: linksResult.value });
  const links = linksResult.value;
  record('The photograph\'s links float around the headset', true, { photograph: photograph.id, links });
  const photo = await waitFor('Both eyes show the photograph', () => probe('pixels'), value => value.left.spread > 12 && value.right.spread > 12 && value.eyeDifference < 12);
  report.photographSettled = await probe('settled', 30000);
  await probe('afterFrames', 10);
  record('Both eyes show the photograph', true, { ...photo, settled: report.photographSettled });
  await screenshot('3-pinch-photograph');

  await headset('pinch', links[0].local);
  const followed = await waitFor('A pinch follows the link', () => probe('state'), value => value.status?.active && value.status.active !== photograph.id && value.status.phase === 'immersive');
  record('A pinch follows the link', true, followed.status);
  const between = await headset('state');
  record('Nothing is tracked once the pinch ends', Array.isArray(between.sources) && between.sources.length === 0, between.sources);

  const ui = await waitFor('The toolbar shows below the view, a "+" at its left end', () => headset('state'),
    value => value.revision > 0 && value.panels.some(panel => panel.id === 'plus') && value.panels.some(panel => panel.kind === 'toolbar'));
  const plus = ui.panels.find(panel => panel.id === 'plus'), bar = ui.panels.filter(panel => panel.kind === 'toolbar');
  const along = (from, to, axis) => (to[0] - from[0]) * axis[0] + (to[1] - from[1]) * axis[1] + (to[2] - from[2]) * axis[2];
  record('The toolbar shows below the view, a "+" at its left end', plus.pose.center[1] < ui.head.position[1] - 0.1
    && bar.every(part => along(plus.pose.center, part.pose.center, plus.pose.right) > 0 && part.pose.center[1] < ui.head.position[1] - 0.1),
    { head: ui.head, plus: plus.pose.center, toolbar: bar.map(part => ({ id: part.id, source: part.source, center: part.pose.center })) });

  await headset('pinch', { panel: 'plus' });
  const menu = await waitFor('A pinch on "+" opens the window menu', () => evaluate(`(() => ({ items: [...document.querySelectorAll('.foss-earth-window-menu-item')].map(item => item.textContent.trim()), panels: window.__fossEarthHeadset.state().panels.filter(panel => panel.kind === 'popup').map(panel => panel.id) }))()`),
    value => value.items.length > 0 && value.panels.length > 0);
  record('A pinch on "+" opens the window menu', true, menu);
  const choice = menu.items[0];
  await evaluate(`[...document.querySelectorAll('.foss-earth-window-menu-item')].find(item => item.textContent.trim() === ${JSON.stringify(choice)}).setAttribute('data-headset-check', '')`);
  const windowsBefore = new Set(ui.panels.filter(panel => panel.kind === 'window').map(panel => panel.id));
  await headset('pinch', '[data-headset-check]');
  const opened = await waitFor('A pinch on a menu item opens its window', () => headset('state'),
    value => value.panels.some(panel => panel.kind === 'window' && !windowsBefore.has(panel.id)) && !value.panels.some(panel => panel.kind === 'popup'));
  const shown = opened.panels.find(panel => panel.kind === 'window' && !windowsBefore.has(panel.id));
  record('A pinch on a menu item opens its window', Boolean(shown), { window: choice, id: shown?.id ?? null, source: shown?.source ?? null });
  await screenshot('5-pinch-window');

  const theme = () => evaluate('document.documentElement.dataset.theme ?? null');
  if (await evaluate(`Boolean(document.querySelector('.theme-button'))`)) {
    const was = await theme();
    await headset('pinch', '.theme-button');
    const now = await waitFor('A pinch presses a toolbar button', theme, value => value !== was);
    record('A pinch presses a toolbar button', true, { theme: [was, now] });
    await headset('pinch', '.theme-button');
  } else console.log('     The page has no theme button on its toolbar to press');

  const ended = await headset('state');
  record('Nothing is tracked after the last pinch', Array.isArray(ended.sources) && ended.sources.length === 0, ended.sources);
}
