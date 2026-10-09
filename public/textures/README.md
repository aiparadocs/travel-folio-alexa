# Kraft paper texture

`kraft-paper.webp` is an original paper texture generated on 2026-10-04 with
the built-in image generation tool, then prepared as a WebP asset for Travel
Folio. It is not sourced from an external stock-image library.

`kraft-paper-source.png` preserves the generated source. The 1254 x 1254 WebP
uses the same dimensions and is about 285 KiB; the displayed paper color and
cream card wash are controlled in CSS, without altering photos.

The journal uses an embedded copy so its texture remains available in saved
HTML and requires no network request at runtime. After replacing the asset,
refresh that copy from the project directory:

```sh
node scripts/embed-paper.js
```

The script replaces only the `--kraft-grain` CSS declaration in
`public/phone/index.html`, preserving the rest of the file and its line endings.

## Light kraft (kippu design, 2026-10-09)

`kraft-paper-light.webp` (1254 x 1254, about 72 KiB) is the very light "生成り" shade chosen for the
kippu & stamp redesign: `kraft-paper.webp` converted to JPEG, then
`ffmpeg -vf eq=brightness=0.33:contrast=0.40:saturation=0.55`, saved as WebP quality 80.
Body text on it measures about 12.9:1. `scripts/embed-paper.js` now embeds this file.
