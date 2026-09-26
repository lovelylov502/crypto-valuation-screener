# TOVENIT · 토베닛

토큰의 가치를 읽는 기준.

## Identity

TOVENIT is a crypto fundamentals research tool for comparing protocol revenue, valuation multiples and holder returns. The brand should feel precise, composed and approachable. Explain the evidence and its limits without promising returns or calling a low multiple a fair value.

- Primary name: **TOVENIT** (uppercase). Korean pronunciation: **토베닛**.
- Tagline: **토큰의 가치를 읽는 기준**.
- Functional description: **프로토콜 수익 · 수익 배수 · 홀더 환원**.
- Symbol: a mint T with an angled crossbar tip. Keep its original proportions and clear space; do not rotate, stretch, outline or add effects.
- Wordmark: bold uppercase sans serif, modest tracking. In the app, Arial/Helvetica keeps the wordmark local and fast; the existing Korean text and table fonts remain in place.
- Palette: navy `#0D1421`, mint `#58DCC4`, ivory `#EDF1F9`, muted text `#ADC0DC`. Mint marks brand identity and selected controls; the existing positive/negative data colors retain their meaning.

## Assets

| File | Use |
| --- | --- |
| `public/brand/tovenit-mark.png` | Transparent 256 × 256 screen symbol |
| `public/brand/tovenit-mark-master.png` | Transparent 1024 × 1024 raster master |
| `public/brand/tovenit-app-icon.png` | 512 × 512 navy app/profile icon |
| `app/icon.png` | 48 × 48 browser icon, served by Next.js |
| `app/apple-icon.png` | 180 × 180 Apple home-screen icon |
| `public/brand/tovenit-social.png` | 1200 × 630 sharing cover |

The master is raster artwork, not an editable vector. Production exports preserve the generated silhouette and alpha. Use the navy icon where a solid background is required. The sharing cover includes the name and tagline within its safe margins.

## Application

`lib/brand.ts` owns the public name, tagline, description and canonical URL. The header, guide introduction, page metadata, Open Graph/Twitter cards and downloaded results carry the new identity. Browser preference keys, financial data definitions, repository identity and Vercel project binding remain stable. A custom domain has not been configured.

## Image generation

The symbol and sharing cover were created with the built-in `image_gen` tool. Sharp only crops transparent padding, resizes and encodes the delivery variants. These prompts describe the art direction; the delivered images are the visual source of truth.

<details>
<summary>Symbol generation prompt</summary>

Use case: logo-brand. Asset type: final standalone transparent symbol for TOVENIT (Korean: 토베닛), an independent cryptocurrency fundamentals research screener. Create ONE original, exceptionally clean, professional flat brand symbol, no typography. The visual identity expresses measurement, comparable evidence and precision. Design a bold geometric capital T monogram with a distinctive diagonal 45-degree cut at the right tip of the horizontal crossbar and a subtle V-shaped angular notch where the crossbar joins the stem. Compact balanced proportions, optically centered, thick solid structure, exceptionally clear at 24 pixels, restrained Swiss financial-information design. Single solid mint-teal color #58DCC4 throughout, hard crisp straight edges, perfectly flat frontal orthographic 2D artwork, no texture, no gradients, no shadow, no outline, no 3D. Square 1024x1024 composition with symbol occupying approximately 72 percent of width and height, generous even transparent padding. Background is genuinely transparent, preserve alpha. NO words, NO letters other than the designed T monogram, NO specimen sheets or mockups, NO surrounding card, NO coins, shields, charts, arrows, blockchain hexagons, circles, glossy effects, watermarks or decorative details. Context: it will sit on a solid very dark navy #0D1421 header beside the word TOVENIT on https://crypto-valuation-screener.vercel.app. Deliver only the final symbol as one transparent image.

</details>

<details>
<summary>Final symbol refinement prompt</summary>

Use case: logo-brand. Edit the supplied TOVENIT logo. Keep the exact overall T silhouette, broad horizontal crossbar, vertical stem, slanted right cap, scale and centered composition. Make this production-ready flat identity artwork: every solid pixel of the logo must be the SAME perfectly flat mint color #58DCC4, with only edge antialiasing. Remove all gradients, lighting, bevels, shading and ghosted shapes. REMOVE the subtle downward triangle in the junction entirely; make that region identical flat mint. Clean up all the edges until straight, smooth, crisp, precise. Transparent background outside the symbol, true alpha; no white or black rectangle. No text, no extra marks, no mockup. ONE clean solid-color T logo, front view.

</details>

<details>
<summary>Sharing cover prompt</summary>

Use case: ads-marketing. Asset type: final social sharing Open Graph cover for TOVENIT, a Korean crypto fundamentals research product. Use the supplied mint T logo as the exact brand symbol. Create a polished, spare editorial identity cover in a wide 1.91:1 landscape ratio, target 1200x630. Solid deep navy #0D1421 background, ivory #EDF1F9 large text, mint #58DCC4 accent. Precise Swiss typographic grid, generous negative space, excellent small-thumbnail readability. Left-aligned composition: logo at upper left around 90px square; below it one large bold custom geometric sans-serif wordmark exactly 'TOVENIT' (T O V E N I T, seven letters, no substitutions), with modest tracking. Under the wordmark, one Korean tagline exactly '토큰의 가치를 읽는 기준' in elegant modern sans-serif, clear and legible. Along the bottom margin a fine mint rule and small uppercase text exactly 'REVENUE  /  VALUATION  /  HOLDER RETURNS'. The right quarter contains only three extremely restrained thin parallel vertical calibration lines in slate navy, suggesting a measurement scale; no charts and no data. Keep all text within an 80px safe margin and place no additional words anywhere. Preserve the source T silhouette and color. Front-facing flat artwork, not a photograph or mockup; no device, no coin, no rocket, no 3D, no glow, no watermark. The result is a finished brand cover, not a website screenshot.

</details>
