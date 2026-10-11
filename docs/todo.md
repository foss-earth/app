# Application follow-ups

## White globe after an update until site storage is cleared (bug)

After the app moved to the native-Tour package builds (ui `bc78085`, engine
`07225a2`, renderer `c6980ea`, scenes `007b8b3`, 360 `138d82b`, images
`02523ea`, preview-sheets `4b688d3`), the dev app at
`http://localhost:5173/app/` in VS Code's built-in browser drew an all-white,
overexposed view. That browser had been used with the earlier builds. Clearing
the site's storage and reloading fixed it. A fresh headless Chrome profile on
the same build rendered normally.

Something an earlier build left in the browser breaks the current one. The
candidates are the saved settings (`localStorage` key `foss-earth.settings.v1`)
and the app files kept by the service worker (Cache Storage, namespace
`foss-earth-app-files`). Which one is not known: clearing storage removed both.
Every returning visitor to the published app carries state from an older build,
so this is not only a development problem.

Expected behavior:

- A build that finds settings or kept files from an earlier build renders
  normally: it migrates what it understands and ignores or replaces the rest.
- No visitor has to clear site storage to recover.

To reproduce, use the app on the package pins it had before the switch, then
install the current pins and reload the same origin. Before clearing anything,
save the `foss-earth.settings.v1` value and the list of Cache Storage entries,
and open `?report` for a diagnostic report. Then clear settings and caches
separately to find which one causes it. Add a regression that loads the
current build over state saved by the previous one.

Reported by the user on 2026-10-11.

## Map button reminder (low priority)

The bottom-right basemap/provider button currently toggles the Map tab. When
Map is already in the foreground, clicking the button closes it. Keep this as
a separate UX follow-up to the map HUD and live Google-key regression repairs.

Expected behavior:

- Open Map when it is closed.
- Bring Map to the foreground when it is open in the background.
- Leave a foreground Map tab open and give a brief visual reminder, such as a
  blue outline on that tab. Respect reduced-motion preferences.

Before landing the change, agree on the reminder with the shared UI owner and
update the documented toolbar-toggle exception. Add a regression covering all
three states through the rendered provider button and the shared overlay.

Reported by the user on 2026-10-10; not implemented by the current repairs.
