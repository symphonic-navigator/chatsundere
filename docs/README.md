# docs/ — chatsune.me

Static teaser site for **Chatsundere**, served via GitHub Pages on
the custom domain **chatsune.me**.

## What this is

- A single-page static HTML teaser
- No build step, no framework, no dependencies
- Ships as-is from `docs/` to GitHub Pages

## Layout

```
docs/
├── CNAME          # custom domain (chatsune.me)
├── .nojekyll      # disable Jekyll processing
├── index.html     # the page itself (inline CSS + JS)
├── assets/
│   └── hero.png   # the Tsundere / Deredere treasure image
└── README.md      # this file
```

## Activating GitHub Pages

In the repository settings on GitHub:

1. **Settings → Pages**
2. **Source:** Deploy from a branch
3. **Branch:** `main` · folder: `/docs`
4. **Custom domain:** `chatsune.me` (already set via the `CNAME` file)
5. Enable **Enforce HTTPS** once the cert is issued

## DNS for chatsune.me

Pointing the apex domain to GitHub Pages requires the following
`A` records at the registrar:

```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```

Plus an optional `AAAA` for IPv6:

```
2606:50c0:8000::153
2606:50c0:8001::153
2606:50c0:8002::153
2606:50c0:8003::153
```

If wanting `www.chatsune.me` to redirect: a `CNAME` record
pointing `www` to `<github-user>.github.io`.

## The hero image

Place the Grok / Seedream output at `assets/hero.png`. The
`index.html` references it as `<img src="assets/hero.png">`.

For social previews (OpenGraph), an additional `assets/og.png`
(1200 × 630 ideal) can be added later — for now `og.png` defaults
to the same image path.

## Design intent

- **Halb-kryptisch**: tagline, hints (E2EE / mobile-first / self-hostable),
  no detailed feature list, no roadmap, no docs
- **Color palette** lifted from the hero image: cyan + magenta + gold
  on deep dark blue
- **Hover behaviour** on the hero: side-aware highlighting reveals
  the two stances ("no compromise" left / "your data, your keys" right)
- **Single CTA**: join the Second Circuit Discord for updates
- **Pure HTML/CSS/JS** so it can be edited from any tool without
  toolchain pain

## Editing

To change copy, palette, or hints: open `index.html`, search for the
relevant text, edit. No rebuild needed — push to `main` and GitHub
Pages will redeploy within a minute or two.
