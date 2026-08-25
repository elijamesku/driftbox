Fonts are loaded from subfolders (see app/globals.css):

  HelveticaNeue/     - Sans-serif UI (HelveticaNeue-Roman.woff2, -Medium, -Bold, etc.)
  InputMono-1/       - Mono for IDE & inputs (InputMono-Regular.woff2, -Medium, -Bold, etc.)
  InputMono-2/       - Condensed & Narrow variants (all weights; imported via stylesheet.css)

Use font-mono-condensed or font-mono-narrow (Tailwind) where you want those widths.
Cascadia Code fallback: /fonts/CascadiaCode.woff2 in this folder if not using CDN.
