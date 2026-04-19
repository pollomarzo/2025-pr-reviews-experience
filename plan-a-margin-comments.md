# Plan A: Block-level comments via margin notes

## Context

Display GitHub PR review comments alongside rendered MyST documents. The target use case is scientific publications reviewed via PR (example: pollomarzo/2025-pr-reviews-experience#1). The source document must NOT be modified.

**Key constraint**: MyST AST position data is available on ~80% of nodes. Headings and paragraphs reliably have `position.start.line`, but block wrappers (grid, aside, admonition, block) do not. This limits line-based anchoring to content-level nodes only.

**PR comment data model** (from GitHub API):
- `path`: file the comment is on (e.g., `index.md`)
- `line`: line number in the file
- `body`: markdown content (may include `` ```suggestion `` blocks)
- `diff_hunk`: surrounding diff context
- `in_reply_to_id`: for threaded replies

## Approach

A post-build script reads the built AST JSON, fetches PR comments, maps them to AST nodes by source line, and injects `commentGroup` nodes as siblings. A new React renderer displays them in the right margin column.

## Steps

### 1. Post-build injection script

**New file**: `scripts/inject-comments.mjs`

- Reads `_build/site/content/<page>.json`
- Fetches PR comments via GitHub API (or reads from a local JSON file for offline use)
- Filters comments to the current file's path
- Walks the AST, builds a map: `source_line -> node_key` for all nodes with `position` data
- For each comment, finds the nearest node at or before `comment.line`
- Groups comments targeting the same node
- Injects a new `commentGroup` node as a sibling after the target node:
  ```json
  {
    "type": "commentGroup",
    "key": "generated-key",
    "comments": [
      {
        "author": "pollomarzo",
        "body": "why did you change this?",
        "line": 4,
        "suggestion": null,
        "replies": []
      }
    ]
  }
  ```
- Writes modified JSON back

### 2. Comment renderer

**New file**: `packages/myst-to-react/src/comments.tsx`

React component registered as a renderer for `commentGroup` nodes.

- Renders in `col-margin-right` (like existing `aside` with kind `margin` in `packages/myst-to-react/src/aside.tsx`)
- Shows grouped comments with:
  - Author name
  - Comment body (rendered as markdown)
  - Suggestion blocks as inline diffs (green/red highlighting)
  - Collapse/expand for threads with replies
- **Stacking fix**: uses `position: relative` instead of `lg:h-0` to avoid the overlapping bug that affects current margin notes. Each comment group takes real vertical space in the margin column.
- On small screens: renders inline within the body column (same fallback as existing margin notes via `col-margin-right` -> `col-body` responsive behavior in `styles/grid-system.css`)

### 3. Register renderer

- `packages/myst-to-react/src/index.tsx`: add `commentGroup: CommentGroupRenderer` to `DEFAULT_RENDERERS`
- `themes/book/app/root.tsx`: already picks up DEFAULT_RENDERERS, no change needed
- `themes/article/app/root.tsx`: same

### 4. General comments section

Comments on non-rendered files (`myst.yml`, `bib.bib`) or general review comments (not anchored to a line) render as a "Review Comments" section at the bottom of the article, before the bibliography. This is a second node type (`commentSummary`) injected at the end of the AST by the same script.

## Trade-offs

| Pro | Con |
|-----|-----|
| Comments appear next to relevant content | Only block-level precision (paragraph/heading) |
| Works with SSR (no client-side API calls) | Requires post-build step |
| Native look and feel, part of document flow | Comments inside directives without position data attach to nearest preceding node |
| Margin column already exists in the grid | Margin column is narrow — long comments may be hard to read |
| No source document modification | Need to re-run injection when comments change |

## Verification

1. `myst build` the docs site
2. Run `node scripts/inject-comments.mjs --pr pollomarzo/2025-pr-reviews-experience#1`
3. `myst start` and verify comments appear in margin next to correct paragraphs
4. Check mobile/responsive: comments should render inline
5. Check dense comments: no overlapping
