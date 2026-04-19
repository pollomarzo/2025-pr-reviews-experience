# Plan C: In-page comment creation via GitHub authentication

## Context

Plan B is now **implemented** and displays existing PR comments via a MyST transform plugin + anywidget. This plan extends Plan B to add the ability to **create new comments** directly from the rendered MyST page, authenticated against GitHub. The user clicks on a content block, writes a comment, and it's posted to the PR as a review comment anchored to the correct source line.

## Current state (from Plan B implementation)

- `plugins/pr-comments.mjs` — MyST transform plugin that reads `pr-comments-data.json` and injects an anywidget node
- `plugins/pr-comments-widget.mjs` — Anywidget ESM module with `render()` and `initialize()`, shows comment panel with scroll-to
- `scripts/fetch-pr-comments.mjs` — Pre-build script to fetch PR data
- The transform adds `data.sourceLine` to the AST; the widget annotates DOM elements client-side for scroll-to
- The widget already dispatches `pr-comment-scroll` events through shadow DOM boundaries

## Approach

An anywidget (or standalone React component) that handles GitHub OAuth authentication and provides a comment authoring UI. Uses the GitHub API to post review comments back to the PR.

## Authentication

### Option 1: GitHub OAuth App (server-assisted)

- Register a GitHub OAuth App
- The widget shows a "Sign in with GitHub" button
- OAuth flow redirects to GitHub, user authorizes, callback returns an access token
- **Requires a server component** (even a tiny one) to exchange the OAuth code for a token — the client secret can't live in the browser
- Could use a lightweight serverless function (Cloudflare Worker, Vercel function, etc.)
- Token stored in `localStorage` or `sessionStorage` for the session

### Option 2: GitHub Device Flow (serverless)

- Uses GitHub's [device authorization grant](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
- Widget shows a code and a link to `github.com/login/device`
- User enters the code on GitHub, authorizes the app
- Widget polls `https://github.com/login/oauth/access_token` until authorized
- **No server needed** — the device flow doesn't require a client secret for public OAuth apps
- Slightly worse UX (user must switch to GitHub and enter a code) but zero infrastructure

### Option 3: Personal Access Token (manual)

- User pastes a GitHub PAT into a field in the widget
- Simplest to implement, no OAuth infrastructure
- Worst UX, but viable for a prototype
- Token stored in `localStorage`

**Recommended**: Option 2 (device flow) for zero-infrastructure auth with decent UX. Option 3 as a fallback for the prototype.

## Comment creation flow

### Step 1: Select target content

User clicks on a paragraph or heading in the rendered document. This requires:
- Content elements have `data-source-line` attributes (same extension as Plan B's scroll-to feature — modify `packages/myst-to-react/src/basic.tsx`)
- A click handler (or hover overlay) on these elements that captures the source line number
- Visual feedback: highlight the selected block, show a "comment" affordance (icon or button)

### Step 2: Compose comment

- A comment editor appears (inline popover near the selected block, or in the margin/panel)
- Supports markdown input (plain textarea for prototype; could add preview later)
- Shows which line/block the comment will be anchored to
- Support for GitHub's `suggestion` syntax:
  ````
  ```suggestion
  replacement text here
  ```
  ````

### Step 3: Post to GitHub

- Uses the authenticated token to call `POST /repos/{owner}/{repo}/pulls/{pr}/comments`
- Required fields:
  - `body`: the comment text
  - `commit_id`: the PR's head commit SHA (fetched once and cached)
  - `path`: the source file path (e.g., `index.md` — known from the PR metadata passed in model data)
  - `line`: the source line number (from `data-source-line` on the clicked element)
- On success: add the new comment to the local widget state so it appears immediately
- On error: show inline error message, preserve the draft

### Step 4: Threading (reply to existing comment)

- Each displayed comment (from Plan A or B) gets a "Reply" button
- Reply uses `POST /repos/{owner}/{repo}/pulls/{pr}/comments` with `in_reply_to` set to the parent comment ID
- Same auth, same editor, posted as a threaded reply

## Architecture

This could be implemented as:

### As an anywidget extension (builds on Plan B)

- Extend the Plan B widget with auth + compose capabilities
- The widget already has the comment data and panel UI
- Add: auth state management, comment editor, API calls
- The shadow DOM isolation actually helps here — auth UI stays contained
- **Cross-shadow-DOM communication** for the "click to select block" feature:
  - Widget registers a `click` listener on `document` (this works from inside shadow DOM)
  - Listener checks if clicked element has `data-source-line`
  - Captures the line number and activates the editor

### As a standalone React component (builds on Plan A)

- A `CommentComposer` component rendered in the margin alongside `commentGroup` nodes
- Auth state managed via React context (a `GitHubAuthProvider`)
- More tightly integrated with the page — can directly read DOM attributes
- But: requires more changes to the theme internals

**Recommended**: Extend the anywidget from Plan B. It's more self-contained and doesn't require theme-level auth plumbing.

## Data flow summary

```
User clicks paragraph -> data-source-line captured
                      -> comment editor opens
                      -> user writes comment
                      -> POST to GitHub API with (path, line, body)
                      -> response added to local state
                      -> comment appears in panel + margin
```

## Security considerations

- **Token storage**: `localStorage` persists across sessions (convenient but less secure). `sessionStorage` is safer but requires re-auth each visit. For a PAT-based prototype, `localStorage` is fine.
- **Scope**: OAuth app should request minimum scope — `repo` for private repos, `public_repo` for public ones
- **CORS**: GitHub API supports CORS for authenticated requests from browsers, so direct API calls work without a proxy
- **Rate limits**: Authenticated requests get 5000/hour — plenty for comment creation

## Trade-offs

| Pro | Con |
|-----|-----|
| Full review workflow without leaving the page | Requires authentication infrastructure (at minimum device flow) |
| Comments posted as real GitHub PR comments | `data-source-line` only works for nodes with position data (~80%) |
| Threaded replies supported | Comment editor UX will be basic compared to GitHub's |
| No server needed with device flow | User must authorize an OAuth app |
| Works with both Plan A and Plan B display approaches | Token management adds complexity |
| Immediate local feedback after posting | Need to handle offline/error states |

## Verification

1. Set up a GitHub OAuth App (or use PAT for prototype)
2. Authenticate in the widget
3. Click on a rendered paragraph — verify `data-source-line` is captured
4. Write and submit a comment
5. Verify comment appears on the GitHub PR page
6. Verify comment appears immediately in the local widget
7. Test reply to an existing comment
8. Test with expired/invalid token — should prompt re-auth
