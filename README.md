# Tap Painter

A relaxing tap-to-paint, colour-by-number game for tablets, phones and desktops.
It's plain HTML, CSS and JavaScript, with no build step and no dependencies.

## Play

Open `index.html` in a browser, either by double-clicking it or through any static
server:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

On iPad or iPhone, open the page in Safari and choose **Share → Add to Home Screen**
to run it full-screen like an app. It also works on GitHub Pages as is.

## How it works

- Pick a colour from the palette at the bottom, then tap every area with that number.
- Pinch or scroll-wheel to zoom, and drag to move around. Small numbers show up as you zoom in.
- Press and hold, then slide, to paint many areas of the selected colour in one go.
- 💡 Hints zoom to an area you haven't found yet. You earn a hint for each colour you finish and three for each finished picture.
- When a picture is done you can watch a replay of your painting and save the image.
- Progress is saved automatically in the browser.
- **New from photo** turns any picture into a puzzle. Choose Relaxed (12 colours),
  Balanced (20) or Detailed (30).

## Code layout

| File | Purpose |
| --- | --- |
| `js/processor.js` | Turns an image into a puzzle: palette quantisation (fixed palette or k-means), region labelling, merging of tiny regions, and number placement using a distance transform. Runs in a Web Worker. |
| `js/artworks.js` | Built-in artwork, drawn procedurally with flat palettes |
| `js/game.js` | Painting screen: rendering, pan/zoom, taps, reveal animation, hints, replay |
| `js/app.js` | Gallery, photo import, screen switching |
| `js/storage.js`, `js/audio.js` | localStorage persistence and generated sound effects |
