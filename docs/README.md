# docs

The screenshots are real screens, not mock-ups. The terminal UI is run inside a
pseudo-terminal, its output captured, and the ANSI replayed into SVG by
`ansi2svg.py`:

| File | Shows |
| --- | --- |
| `screenshot.svg` | Reading a note — the two-column layout |
| `screenshot-editing.svg` | The editor, with a list carrying itself on |

To regenerate one, run the app under a pty, save the raw output, and pass it
through the converter:

```bash
python3 docs/ansi2svg.py capture.raw docs/screenshot.svg "nib"
```

`COLS, ROWS` at the top of the converter must match the pseudo-terminal's size,
or the replay will wrap in the wrong places.

Each row is emitted as a single `<text>` carrying an explicit x for every
column, so a cell can never drift from the grid. Positioning colour runs
individually instead lets rounding accumulate across a row, which pulls the
box-drawing verticals out of line and splits the borders.

Capture the terminal at a height where the frame you want is as tall as the one
it replaced. The app repaints only the rows that changed, so a shorter frame
leaves rows of the previous screen underneath it.

SVG rather than PNG so the text stays crisp at any size, the file is a few
kilobytes, and a diff is readable.

## The diagrams

`architecture.d2` and `dataflow.d2` are [D2](https://d2lang.com) source; the SVGs
beside them are generated and committed so the README renders on GitHub without
a build step.

```bash
d2 docs/architecture.d2 docs/architecture.svg
d2 docs/dataflow.d2     docs/dataflow.svg
```

Each board sets its own light `style.fill` rather than going transparent. A
README is read on GitHub in both themes, and d2's dark theme only remaps its own
palette classes — not the explicit colours in these files — so a transparent
board would render dark text on a dark page for half the readers.

## The web screenshot

`screenshot-web.png` and `screenshot-web-dark.png` are real screens of the
browser UI, taken at 1440×900 against a throwaway database of demo notes — never
against real ones, since the file is published. PNG rather than SVG here because
a browser screenshot is a raster image; the terminal shots above stay SVG.

## A note on the binary

`./build.sh` compiles with cgo enabled, so the binary it leaves in the working
tree is dynamically linked against libc. Releases are not: `.github/workflows/release.yml`
sets `CGO_ENABLED=0` and fails the build if `file` does not say "statically linked".

Do not quote the size of any local build. A local `CGO_ENABLED=0` build still
embeds whatever is in `internal/web/dist`, which is not what CI's `npm ci`
produces — the two differed by 0.7 MB at v1.6.0. Read the figure off the
published asset instead:

```bash
gh release download v1.6.0 --dir /tmp/rel
cd /tmp/rel && sha256sum -c checksums.txt
ls -l nib-linux-amd64
```
