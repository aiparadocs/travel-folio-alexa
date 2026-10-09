# Travel Folio fonts

All fonts come from Google Fonts under the SIL Open Font License 1.1; licence texts are alongside.
The app serves them locally and does not contact a font service at runtime.

## Kippu & stamp design (home, Echo Show card)

Small subsets made with the Google Fonts `text=` API by `scripts/fetch-fonts.mjs`: Latin
(U+0020–007E, U+00A0–00FF, typographic punctuation) plus the few kanji the design prints.

| File | Font | Used for |
|---|---|---|
| `dela-gothic-one.woff2` | Dela Gothic One | Headings, logo, stamp names (incl. the kanji in `public/stamps.js`) |
| `dotgothic16.woff2` | DotGothic16 | Times, ticket printing, departure boards |
| `biz-udpgothic-400.woff2`, `biz-udpgothic-700.woff2` | BIZ UDPGothic | Body text and controls |
| `klee-one-600.woff2` | Klee One (SemiBold) | Handwritten captions and notes |

Licences: `delagothicone-OFL.txt`, `dotgothic16-OFL.txt`, `bizudpgothic-OFL.txt`, `kleeone-OFL.txt`.
The CSS family names are prefixed (`Folio Display`, `Folio Dot`, `Folio UD`, `Folio Pen`, see
`public/kippu.css`) so a locally installed BIZ UDPGothic still renders Japanese text the subsets lack.
After changing the stamp names in `public/stamps.js`, run `node scripts/fetch-fonts.mjs`.

## Phone journal (until its redesign)

Caveat (500–700) and Nunito (400–800) Latin WOFF2 subsets, with `fonts.css`:

- https://fonts.gstatic.com/s/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYY.woff2
- https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2

Notices: `Caveat-OFL.txt`, `Nunito-OFL.txt` (Quicksand is no longer used). After changing these
assets or `fonts.css`, run `node scripts/embed-fonts.js` to update the standalone phone journal.
