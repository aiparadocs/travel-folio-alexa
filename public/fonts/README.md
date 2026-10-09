# Travel Folio fonts

All fonts come from Google Fonts under the SIL Open Font License 1.1; licence texts are alongside.
The app serves them locally and does not contact a font service at runtime.

## Kippu & stamp design (home, Echo Show card, phone journal)

Small subsets made with the Google Fonts `text=` API by `scripts/fetch-fonts.mjs`: Latin
(U+0020–007E, U+00A0–00FF, typographic punctuation) plus the few kanji the design prints.

| File | Font | Used for |
|---|---|---|
| `dela-gothic-one.woff2` | Dela Gothic One | Headings, logo, stamp names (incl. the kanji in `public/stamps.js`) |
| `dotgothic16.woff2` | DotGothic16 | Times, ticket printing, departure boards |
| `biz-udpgothic-400.woff2`, `biz-udpgothic-700.woff2` | BIZ UDPGothic | Body text and controls |
| `klee-one-600.woff2` | Klee One (SemiBold) | Handwritten captions and notes |

Licences: `delagothicone-OFL.txt`, `dotgothic16-OFL.txt`, `bizudpgothic-OFL.txt`, `kleeone-OFL.txt`.
The CSS family names are prefixed (`Folio Display`, `Folio Dot`, `Folio UD`, `Folio Pen`, defined in
`fonts.css`) so a locally installed BIZ UDPGothic still renders Japanese text the subsets lack.
After changing the stamp names in `public/stamps.js`, run `node scripts/fetch-fonts.mjs`.

The phone journal embeds these same files (and licences) via `scripts/embed-fonts.js`; the
earlier Caveat, Nunito and Quicksand fonts were retired on 2026-10-09.
