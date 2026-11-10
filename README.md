# Core Hopper

Mine a tiny planet down to its core, build a factory on a ring conveyor around it, build a rocket and hop to the next world.

- **Ring factory:** every planet has a circular belt with a fixed number of slots. Drills put ore on the belt; furnaces, presses, assemblers and refineries take what they need as it passes and put their products back; Docks store what reaches them.
- **Digging:** every ore mined makes the hole deeper. New layers unlock new ores. Reach the core and finish the rocket to launch.
- **Hopping:** each launch earns a Star Core for permanent upgrades on the star map, then you start fresh on a bigger planet.
- **Breaks:** the factory keeps working while you are away (3 hours, 8 with the Long Nap upgrade), comets pass every few hours, and goals guide each session.
- **Story:** Mother (the ship AI), Pip (your robot) and the logs of the explorer "H." who came before you.

## Build and test

```bash
node build.mjs            # writes dist/index.html (one file, CSS and JS inlined), sw.js, manifest and icons
node test/play.mjs out    # phone and desktop playthrough with screenshots
node test/fullrun.mjs out # a bot plays a whole world, launches and travels to the next one
```

`python3 tools/icons.py` redraws the app icons in `assets/`.

Settings → Test speed runs the game (and its clock) up to 20× faster for testing.
