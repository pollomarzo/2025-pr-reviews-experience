# Plan B: Anywidget comment panel (IMPLEMENTED)

## Status: ✅ Working prototype

## Context

Display GitHub PR review comments alongside rendered MyST documents. The target use case is [pollomarzo/2025-pr-reviews-experience#1](https://github.com/pollomarzo/2025-pr-reviews-experience/pull/1). The source document must NOT be modified.

## Implementation approach

Instead of a post-build script that patches JSON (as originally planned), we use **MyST's JavaScript plugin system** — specifically a `transform` that runs at build time, reads PR comment data, and injects an `anywidget` node directly into the AST. The widget ESM module is automatically bundled by MyST's asset pipeline.

This avoids:
- Modifying the source `index.md`
- Patching build artifacts post-hoc
- Requiring changes to `myst-theme`

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Pre-build step (manual or CI)                                    │
│                                                                  │
│  scripts/fetch-pr-comments.mjs ──► pr-comments-data.json         │
│     (gh api, GitHub REST)           (PR metadata + comments)    │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Build time (myst build / myst start)                             │
│                                                                  │
│  plugins/pr-comments.mjs (transform plugin)                     │
│    ├── Reads pr-comments-data.json                               │
│    ├── Walks AST → builds line → key map                         │
│    ├── Adds data.sourceLine to paragraph/heading nodes           │
│    ├── Builds file_map: comment_id → source_line                 │
│    └── Injects anywidget node at top of content block            │
│                                                                  │
│  MyST asset pipeline                                             │
│    └── Copies & hashes plugins/pr-comments-widget.mjs            │
│         → _build/site/public/pr-comments-widget-HASH.mjs        │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│ Runtime (browser)                                                │
│                                                                  │
│  pr-comments-widget.mjs (anywidget)                              │
│    ├── render({ model, el })                                     │
│    │   └── Builds comment panel with PR data from model           │
│    └── initialize({ model })                                     │
│        ├── Fetches page JSON → annotates DOM with                │
│        │   data-source-line attributes                            │
│        └── Listens for pr-comment-scroll events                  │
│            └── Scrolls to matching element + highlight            │
└──────────────────────────────────────────────────────────────────┘
```

### Files created/modified

| File | Purpose |
|------|---------|
| `scripts/fetch-pr-comments.mjs` | Pre-build script: fetches PR data from GitHub via `gh api` |
| `plugins/pr-comments.mjs` | MyST transform plugin: walks AST, injects anywidget node |
| `plugins/pr-comments-widget.mjs` | Anywidget ESM module: renders the comment panel UI |
| `pr-comments-data.json` | Generated data file (gitignored) |
| `myst.yml` | Added `project.plugins` entry |

### Key design decisions

1. **MyST plugin instead of post-build script** — The original plan called for a script that modifies `_build/site/content/*.json` after build. Using a MyST transform plugin is cleaner: it operates on the AST during the build pipeline, and MyST's asset pipeline handles ESM bundling automatically.

2. **Source lines instead of node keys for scroll-to** — MyST regenerates AST node keys between the transform stage and the final JSON. We store source line numbers in `file_map` (stable) instead of node keys (unstable). The widget's `initialize` function fetches the page JSON to annotate DOM elements with `data-source-line` attributes for scroll targeting.

3. **Widget ESM bundling** — MyST automatically copies and content-hashes the widget's `.mjs` file into `_build/site/public/` and rewrites the `esm` URL in the AST. No manual asset management needed.

4. **Comments on non-rendered files** — Comments on `myst.yml` and `bib.bib` (which are not rendered as pages) still appear in the panel but don't have scroll-to targets in the document. The `current_file` field in the model tells the widget which file is currently rendered.

## How to use

### 1. Fetch PR comment data

```bash
# One-time: fetch comments from GitHub
node scripts/fetch-pr-comments.mjs --pr pollomarzo/2025-pr-reviews-experience#1 --out pr-comments-data.json
```

### 2. Build / serve

```bash
myst start   # dev server
# or
myst build --html   # static build
```

The transform plugin is registered in `myst.yml`:
```yaml
project:
  plugins:
    - plugins/pr-comments.mjs
```

### 3. View

The comment panel appears at the top of the article content. Click the ↗ button on any inline comment that has a scroll target to navigate to the relevant paragraph.

## Current PR data (pollomarzo/2025-pr-reviews-experience#1)

The PR has:
- **4 inline comments** (2 on `index.md` lines 53 & 57, 1 on `myst.yml` line 4, 1 on `bib.bib` line 14)
- **1 review** (general comment)
- **1 issue comment** (deploy bot notification)

Two of the inline comments include `` ```suggestion `` blocks with proposed text changes.

## Known issues & next steps

### ⚠️ ESM path warning
The build logs `⛔️ Cannot find asset for 'esm' "./plugins/pr-comments-widget.mjs" in _build/cache` for the config page (which also gets the transform). This is harmless for the content page but could be fixed by making the transform only apply to content pages, not config pages.

### 📝 `data-source-line` in HTML
The `data.sourceLine` attribute is present in the AST JSON but MyST's React renderers don't pass it through to the rendered HTML. The widget works around this by fetching the page JSON client-side and annotating DOM elements. A proper fix would add `data-source-line` passthrough to `myst-to-react`'s paragraph and heading renderers. See: [myst-theme issue TBD].

### 📝 Widget placement
The widget currently renders at the very top of the article (as the first child of the content block). A better placement would be in the right margin column (`col-margin-right`), alongside the document outline. This requires either:
- A theme-level slot/placeholder for the margin widget, or
- The widget rendering into a shadow DOM that positions itself absolutely/sticky on the margin

### 📝 Multi-file support
Currently all comments (including those on `myst.yml` and `bib.bib`) are shown in the panel. For multi-file MyST sites, the transform should filter comments to only those matching the current page's file path.

### ✅ Shadow DOM
The anywidget renders in a shadow DOM (per the MyST anywidget renderer). This provides style isolation but means the widget can't directly affect page-level styles. The `pr-comment-scroll` custom event uses `composed: true` to bubble through the shadow boundary.

### ✅ Dark mode
The widget uses CSS custom properties (`--myst-color-*`) that respond to the theme's color scheme, providing automatic dark mode support.

## Original plan comparison

| Original plan | Implemented as |
|---|---|
| Post-build injection script | ✅ MyST transform plugin (cleaner, no source modification) |
| Widget in `docs/src/` | ✅ Widget in `plugins/` (same directory as transform) |
| Inject `anywidget` node in JSON | ✅ Transform injects node in AST during build |
| `data-source-line` on rendered elements | ⚠️ Added to AST but not rendered by theme; widget fetches page JSON to annotate DOM client-side |
| Scroll-to via custom events | ✅ `pr-comment-scroll` custom event with `composed: true` |
| Right margin placement | 🔄 Widget renders at top of content; margin placement needs theme support |
| Collapse/expand for threads | ✅ Threaded replies indented |
| Dark mode | ✅ CSS custom properties |