# karet-docs

[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare%20Pages-deployed-orange?logo=cloudflare)](https://karet.joeyshi.xyz)

VitePress documentation site for Karet.

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # static HTML in .vitepress/dist
npm run preview      # preview the built site
```

## Layout

- `index.md`: landing page (hero + feature grid).
- `guide/`: narrative docs (getting started, architecture, templates,
  webhooks, auth, AWS deploy).
- `reference/`: schema and HTTP API reference (pipeline config,
  dashboard config, worker API, web API).
- `.vitepress/config.ts`: site config (nav, sidebar, search).

## Deploying

`npm run build` writes static HTML to `.vitepress/dist/`. Drop that in
any static host: GitHub Pages, Netlify, S3 + CloudFront, etc. No
server-side runtime required.
