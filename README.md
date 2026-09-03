# Rootbound

Rootbound is a browser idle game about caring for one small tree as it grows through seasons and time.

## Run locally

Because the live weather request needs a web origin, serve the folder with any static server. For example:

```powershell
py -m http.server 8080
```

Then open `http://localhost:8080`.

The game also works from `index.html` directly, but it will use its seasonal weather fallback instead of requesting live Port Elizabeth weather.

## Current slice

- Wall-clock and offline growth with safe clock rollback handling
- Water, encourage, and fertilise actions with cooldowns
- Procedural pixel-art tree, grass, clouds, day/night, seasons, rain, wind, and autumn leaves
- LocalStorage save data
- Endless stage progression and repeatable growth rings
- First-pass endless upgrade tree and field journal
- Live Port Elizabeth weather through Open-Meteo when served over HTTP(S)

The artwork in `StyleReferences` and the CraftPix ZIP are reference material only; they are not used by the game until their licences are confirmed.
