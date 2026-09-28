# Tap Painter

A relaxing tap-to-paint, colour-by-number game for tablets, phones and desktops.
It's plain HTML, CSS and JavaScript with no dependencies. The only build step is an optional script that prepares your pictures.

## Play

Serve the folder with any static web server and open it in a browser:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

(Opening `index.html` straight from disk won't work. Browsers block reading the
pixels of local image files.) It also works as is on GitHub Pages. On iPad or
iPhone, open it in Safari and choose **Share → Add to Home Screen** to run it
full-screen like an app.

## Adding pictures

Drop images (jpg, png, webp) into `images/`, then run:

```sh
pip install pillow
python3 tools/build_gallery.py
```

This creates web-sized copies in `images/web/`, thumbnails in `images/thumbs/`,
and the picture list in `js/gallery-data.js`. You can edit the titles in that
file; they're kept the next time you run the script. Removing an image and
re-running cleans up its copies.

## How it works

- Pick a colour from the palette at the bottom, then tap every area with that number.
- Pinch or scroll-wheel to zoom, and drag to move around. Small numbers show up as you zoom in.
- Press and hold, then slide, to paint many areas of the selected colour in one go.
- 💡 Hints zoom to an area you haven't found yet. You earn a hint for each colour you finish and three for each finished picture.
- When a picture is done you can watch a replay of your painting and save the image.
- Progress is saved automatically in the browser.
- The Relaxed, Balanced and Detailed switch on the gallery screen sets how many colours
  and areas each picture is cut into. Every area is big enough to hold a readable
  number. Progress is kept separately for each level.
- **New from photo** turns any picture on your device into a puzzle.

## Code layout

| File | Purpose |
| --- | --- |
| `js/processor.js` | Turns an image into a puzzle. A painterly Kuwahara filter smooths it, k-means in Lab colour space picks the palette, small or thin areas merge into their neighbours, a distance transform places the numbers, and region borders are traced into shared, smoothed vector outlines. Runs in a Web Worker. |
| `js/game.js` | Painting screen: vector rendering, pan/zoom, taps, reveal animation, hints, replay |
| `js/app.js` | Gallery, detail levels, photo import, screen switching |
| `js/gallery-data.js` | Generated picture list (see *Adding pictures*) |
| `js/storage.js`, `js/audio.js` | localStorage persistence and generated sound effects |
| `tools/build_gallery.py` | Builds web copies, thumbnails and the picture list from `images/` |
