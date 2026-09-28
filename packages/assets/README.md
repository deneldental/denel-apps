# @framada/assets

Shared brand/static assets for the Framada apps. Files live in `src/` and are
**imported in code** — each app's bundler resolves the import, fingerprints the
file, and emits a copy into that app's own build output. One source of truth in
the repo; every app ships its own self-contained copy (no runtime coupling).

```ts
import markUrl from '@framada/assets/logo-icon.svg'
// <img src={markUrl} alt="Denel Dental" />
```

Add new shared assets to `src/` and import them by path (`@framada/assets/<file>`).

Note: this covers assets **referenced in code**. Public/URL assets (PWA manifest
icons, `favicon`, files at fixed paths in `index.html`) still live in each app's
`public/`; unify those later with `vite-plugin-static-copy` if desired.
