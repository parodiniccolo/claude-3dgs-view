# Claude 3DGS View

A Claude Code mod that previews 3D Gaussian splats in a pane. Run `/splat scene.ply` and orbit the scene with the mouse without leaving the terminal.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

![Claude 3DGS View in action](https://github.com/parodiniccolo/claude-3dgs-view/releases/download/v0.1.0/claude-3dgs-view.gif)

## Install

Inside Claude Code, run:

```
/plugin marketplace add parodiniccolo/claude-3dgs-view
/plugin install 3dgs-view
/reload-plugins
```

Then `/splat path/to/scene.ply`. A pane opens with the first frame a few seconds later.

<details>
<summary><strong>Prefer the terminal?</strong></summary>

```bash
claude plugin marketplace add parodiniccolo/claude-3dgs-view
claude plugin install 3dgs-view@claude-3dgs-view
```

Then run `/reload-plugins` inside a session, or start a new one.

</details>

## What You See

```
◆ scene.ply  969 MB · 3.9M splats  ● ready
┌──────────────────────────────────────────┐
│                                          │
│              (the splat scene)           │
│                                          │
└──────────────────────────────────────────┘
orbit · az 210° · el 20° · dist 0.50      drag orbits · right-drag pans · wheel zooms · esc to prompt
a: ◀ orbit   d: orbit ▶   q: ▲ up   e: ▼ down   w: zoom in   s: zoom out   m: mode: orbit   r: reset
o: open in browser
```

- **Two modes**, switched with `m`. *Orbit* circles the scene. *Look around* stands at one spot and turns 360° in place, which suits room scans; there `w`/`s` and the wheel walk forward and back.
- **Mouse.** Drag to orbit (or look), right-drag to pan (or slide), wheel to zoom (or walk). While dragging you get quick low-resolution frames, then a sharp one when you let go.
- **Keys** work while the pane has focus (it opens focused; `ctrl+x` then `tab` gets it back): `a`/`d` orbit or turn, `q`/`e` tilt, `w`/`s` zoom or walk, `m` switches mode, `r` resets the camera.
- **Browser.** `o` opens the interactive viewer at the same viewpoint and mode, with the same keys and mouse controls.
- **It offers itself.** Mention a splat file in a prompt, or let Claude touch one with a tool, and a line above the prompt asks whether to preview it. Press `1` for yes, `2` for no.
- **Formats:** `.ply` (3DGS and compressed), `.spz`, `.splat`, `.ksplat`, `.sog`, whatever [Spark](https://sparkjs.dev) loads.

## How It Works

Claude 3DGS View is a [mod](https://code.claude.com/docs/en/plugins/mods/overview). Terminals can't run WebGL, so the rendering happens in a browser you never see:

1. `/splat <file>` starts a small Python server on `127.0.0.1` (`hooks/serve.py`) that serves the splat file and a viewer page (`hooks/viewer.html`) built on [Spark](https://github.com/sparkjsdev/spark) and three.js.
2. The server launches headless Chrome on that page once. The page loads the splat, frames it from the 5th–95th percentile of splat centers (floaters would stretch a plain bounding box), renders, and POSTs a PNG back.
3. The pane draws that PNG with Claude Code's `Image` element. The terminal reads the file itself, so no pixels pass through the mod. A transparent `Client` region over the picture catches mouse drags.
4. Every move is one HTTP request to the server, which hands the new camera to the already-loaded page through a long poll. A drag frame takes about 0.1 s; a sharp frame about 2 s on a 4M-splat scene.

In orbit mode the camera circles the framed center: azimuth, elevation, distance, plus a pan of the orbit target in camera space. In look-around mode it stands at a point offset from the center in world space and faces along the same azimuth and elevation. The footer is laid out by the mod, not the terminal, so the picture takes exactly the rows the keys leave.

## Terminal Support

Claude Code draws real pictures in Ghostty and kitty (and the mod also trusts WezTerm). Anywhere else the pane shows the file info, a link to the interactive viewer and `o` to open it in the browser. There is no picture in Terminal.app, iTerm2, VS Code or inside tmux: character-cell fallbacks were tried and are not worth looking at for a photographic scene.

| Terminal | Pane |
|---|---|
| Ghostty, kitty, WezTerm | Picture, mouse and keys |
| Everything else | File info and the browser link |

## Security

The mod runs local processes on your behalf. In full:

- **A local HTTP server** (`python3 hooks/serve.py`) bound to `127.0.0.1` on a random port, serving the splat file and the viewer page to that machine only. It stops when the session ends or the mod reloads.
- **Headless Chrome**, found at `/Applications/Google Chrome.app`, `google-chrome` or `chromium` on `PATH`, or `$CHROME_BIN`, with its own throwaway profile under `/tmp/claude-splat-preview/`. The server kills it when it stops.
- **Network:** the viewer page loads three.js from jsDelivr and Spark from `sparkjs.dev`. Those are the only requests that leave the machine. The splat file never does.
- **Files:** it `stat`s the paths it is given or finds in prompts and tool inputs, writes frames under `/tmp/claude-splat-preview/`, and runs `curl` against its own server and `open` on the viewer URL when you press `o`.
- It reads `HOME`, `TERM` and `TERM_PROGRAM` to resolve paths and to tell whether your terminal draws pictures.

Run `claude plugin validate` on the repo to see every event it hooks and every call it makes.

## Requirements

- Claude Code v2.1.287 or later (mods support). Tested with v2.1.296; the mods API is early access and moves between releases.
- macOS or Linux with `python3`, `curl` and Google Chrome or Chromium. Rendering uses the GPU through headless Chrome; a 4M-splat scene loads in about 15 s.
- For the picture in the pane, [Ghostty](https://ghostty.org), [kitty](https://sw.kovidgoyal.net/kitty/) or WezTerm. Other terminals get the browser link.

## Troubleshooting

**`/splat` says "Unknown command".** The mod isn't loaded in that session. Run `/plugin` and check that `3dgs-view` is listed as an active mod, or `/reload-plugins`.

**The pane stays on "rendering".** Chrome didn't start or the page failed. The status line shows the page's last error. Set `CHROME_BIN` if Chrome isn't in the usual place. `pkill -f headless=new` clears a stuck instance.

**The first frame is a blur or a wall.** The automatic framing put the camera outside a room scan. Press `w` a couple of times to move inside, or `r` to reset.

**No picture, only a link.** Your terminal doesn't draw images. See [Terminal Support](#terminal-support).

**It offers to preview a `.ply` mesh.** The mod can't tell a mesh from a splat by name. Press `2`.

## Development

```bash
git clone https://github.com/parodiniccolo/claude-3dgs-view
cd claude-3dgs-view

# Load it for one session without installing
claude --plugin-dir .

# Check it and run the tests
claude plugin validate .
claude plugin test .
```

Claude Code writes the API types into `.claude-plugin/types/` the first time it loads the mod, and `tsc -p .` type-checks it from then on. The viewer page and server can be exercised on their own: `python3 hooks/serve.py hooks/viewer.html scene.spz /tmp/shot.png` prints a port, and `curl "http://127.0.0.1:<port>/snap?az=30&el=20&d=1.6"` renders a frame to `/tmp/shot.png`.

## License

The code is MIT. See [LICENSE](LICENSE).

The splat in the demo is [Ceramic Studio](https://superspl.at/scene/13b9a601) by [Victor Saliba](https://superspl.at/user/victorsaliba), licensed under [CC BY-NC 4.0](http://creativecommons.org/licenses/by-nc/4.0/): credit the author, no commercial use. It is not part of this repository.
