# Brand assets

`emblem-source.png` is the KLEA emblem as it was supplied: 1024 × 1536, transparent
background, 788 KB. It is kept here, not in `public/`, so that nobody serves it.

What the site serves is made from it, at the size each place shows it (D35):

```bash
SRC=docs/brand/emblem-source.png
convert $SRC -trim +repage -resize x320 -strip -colors 192 public/emblem.png        # 11.9 KB
convert $SRC -trim +repage -resize x112 -strip -colors 128 public/emblem-mark.png   # 2.2 KB, shown at 44 px
convert $SRC -trim +repage -resize 160x160 -background white -gravity center \
  -extent 180x180 -strip -colors 128 public/apple-touch-icon.png
convert $SRC -trim +repage -background none -gravity center \
  \( -clone 0 -resize 16x16 -extent 16x16 \) \( -clone 0 -resize 32x32 -extent 32x32 \) \
  \( -clone 0 -resize 48x48 -extent 48x48 \) -delete 0 -colors 64 public/favicon.ico
```

At 16 px the roots are noise. A simplified mark for the favicon — the key and the
flag — is a design decision for KLEA, not a resize.
