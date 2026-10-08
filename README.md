# Susuki by the river

Japanese silver grass (*susuki*, Miscanthus sinensis) along a small river, at dusk and under the Moon, in three.js. Drag to part the grass, and run your finger across the river to ripple it.

**Open: https://aiimpl.github.io/susuki/** (`?lang=ja` for Japanese, `?t=moon` to start in moonlight)

Nothing is pre-rendered and there are no image files: the grass, the water, the sky and the light are all computed in the browser.

## How it is built

| | |
|---|---|
| Clumps | About 6,000 clumps on a jittered grid that gets coarser with distance, inside the view. Each one has long arching leaves and 10–30 flowering stems |
| Leaves | One instanced strip per leaf, bent on the GPU along a quadratic Bézier curve (the approach of Ghost of Tsushima's grass, GDC 2021). Normals are tilted across the width so the flat strip reads as a rounded blade |
| Plumes | Each stem carries 14 racemes (8 far away), drawn as camera-facing ribbons. The silky hairs are noise streaks in the fragment shader, cut out with alpha-to-coverage on a 4× MSAA target, so no sorting is needed |
| Light | Wrapped diffuse light, sky light, and light shining through thin leaves and hairs when you look toward the Sun or the Moon. That is what makes the plumes glow when backlit |
| Wind | Noise bands drift across the field (gusts) on top of a small flutter. Plumes catch more light where a gust lays them down, so you can watch the waves cross the field |
| Your hand | A top-down trample map (a ping-pong render target): the drag pushes stalks away from its path, and they rise again over a few seconds |
| River | The scene is drawn a second time, mirrored in the water plane, into a texture. The surface samples it through normals from noise drifting downstream, with Fresnel, glitter where the Sun or the Moon reflects, and ripples from a damped wave equation solved on the GPU and carried by the current |
| Sky | A gradient with the glow around the light, thin clouds, the Moon's disc and stars. The same colours are used for the haze, so distant plumes fade into the sky |
| Post | HDR, bloom, ACES tone mapping, vignette and grain |

- `web/src/glsl.js`: shared GLSL (the land and the river, wind, sky, haze, foliage light)
- `web/src/world.js`: the same land in JS, where the clumps grow
- `web/src/susuki.js`: leaves and plumes
- `web/src/water.js`: the river surface, ripples, the trample map, drifting seeds
- `web/src/land.js`: ground, distant hills, sky
- `web/src/main.js`: renderer, reflection pass, light keys, the page
- `web/src/film.js`: the 15-second video (`?film`)
- `tools/`: frames for the video (`render.py`), the mp4 (`encode.sh`), a page check at desktop and phone size (`check_page.py`)

```sh
make serve          # http://127.0.0.1:8811/
make setup          # Python + Playwright for the video and the check
make film video     # build/susuki.mp4 (1080x1350, 60 fps)
make check
```

## License
MIT (this repository). three.js (MIT) is in `web/vendor/`.
