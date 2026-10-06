# Travel Folio fonts

Caveat (500–700) is used for handwritten headings and journal accents; Nunito
(400–800) for readable body text and controls. These unmodified Latin WOFF2
subsets come from Google Fonts:

- https://fonts.gstatic.com/s/caveat/v23/Wnz6HAc5bAfYB2Q7ZjYY.woff2
- https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2

Copyright and SIL Open Font License notices are preserved in `Caveat-OFL.txt`
and `Nunito-OFL.txt`. Other writing systems use the device's fallback fonts.
The app serves these files locally and does not contact a font service at runtime.

After changing these assets or `fonts.css`, run `node scripts/embed-fonts.js` from
the app directory to update the standalone phone journal's embedded fonts/licenses.
