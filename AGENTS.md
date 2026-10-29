<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Style file organization

Keep standalone style files in the root `styles/` directory. Component CSS Modules belong in `styles/components/<feature>/`; preserve their `.module.scss` extension and import them from the component. Keep standalone theme style helpers (`*.styles.ts`) in the same feature directory. Do not add component-adjacent stylesheets under `src/`.
