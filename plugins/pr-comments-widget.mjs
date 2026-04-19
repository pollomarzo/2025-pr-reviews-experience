/**
 * PR Comments Anywidget — renders comment cards in margin asides.
 *
 * Two modes controlled by model.mode:
 *   - "inline": renders one or more comment cards for a specific line
 *   - "meta": renders reviews + issue comments as a general panel
 *
 * Model data (injected by transform):
 *   - mode: "inline" | "meta"
 *   - pr: { title, url, number, author, state }
 *   - comments: [{ id, path, line, author, author_avatar, body, diff_hunk, in_reply_to_id }]
 *   - reviews: [{ id, author, body, state }]
 *   - issue_comments: [{ id, author, body, created_at, url }]
 */

/* ── Helpers ─────────────────────────────────────────────────────────── */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Naive markdown → HTML for comment body */
function renderMd(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="prc-code-block${lang ? ' language-' + lang : ''}"><code>${code.trim()}</code></pre>`;
  });
  html = html.replace(/`([^`]+)`/g, '<code class="prc-inline-code">$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/@(\w+)/g, '<span class="prc-mention">@$1</span>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

/** Parse suggestion blocks from comment body */
function parseSuggestions(body) {
  const suggestions = [];
  const re = /```suggestion\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    suggestions.push(m[1].trimEnd());
  }
  return suggestions;
}

function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return iso; }
}

/* ── Build UI: inline comment cards ───────────────────────────────────── */

function buildCommentCard(c) {
  const card = document.createElement('div');
  card.className = 'prc-comment-card';

  const suggestions = parseSuggestions(c.body);
  const bodyNoSuggestion = c.body.replace(/```suggestion\n[\s\S]*?```/g, '').trim();

  // Header: avatar + author
  const header = document.createElement('div');
  header.className = 'prc-comment-header';

  if (c.author_avatar) {
    const img = document.createElement('img');
    img.className = 'prc-avatar';
    img.src = c.author_avatar;
    img.alt = c.author;
    img.width = 20;
    img.height = 20;
    header.appendChild(img);
  }

  const meta = document.createElement('span');
  meta.className = 'prc-meta';
  meta.innerHTML = `<strong>${escapeHtml(c.author)}</strong>`;
  if (c.created_at) meta.innerHTML += ` <span class="prc-date">${formatDate(c.created_at)}</span>`;
  header.appendChild(meta);

  // Link to GitHub
  if (c.url) {
    const link = document.createElement('a');
    link.className = 'prc-permalink';
    link.href = c.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = 'View on GitHub';
    link.textContent = '↗';
    header.appendChild(link);
  }

  card.appendChild(header);

  // Body
  if (bodyNoSuggestion) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'prc-comment-body';
    bodyEl.innerHTML = renderMd(bodyNoSuggestion);
    card.appendChild(bodyEl);
  }

  // Suggestions
  for (const sug of suggestions) {
    const sugEl = document.createElement('div');
    sugEl.className = 'prc-suggestion';
    sugEl.innerHTML = `<div class="prc-suggestion-label">Suggestion</div><pre class="prc-suggestion-code"><code>${escapeHtml(sug)}</code></pre>`;
    card.appendChild(sugEl);
  }

  return card;
}

/* ── Build UI: review card ────────────────────────────────────────────── */

function buildReviewCard(r) {
  const card = document.createElement('div');
  card.className = 'prc-review-card';

  const header = document.createElement('div');
  header.className = 'prc-comment-header';

  if (r.author_avatar) {
    const img = document.createElement('img');
    img.className = 'prc-avatar';
    img.src = r.author_avatar;
    img.alt = r.author;
    img.width = 20;
    img.height = 20;
    header.appendChild(img);
  }

  const meta = document.createElement('span');
  meta.className = 'prc-meta';
  const stateLabel = r.state === 'COMMENTED' ? 'left a review' : r.state.toLowerCase();
  meta.innerHTML = `<strong>${escapeHtml(r.author)}</strong> ${escapeHtml(stateLabel)}`;
  header.appendChild(meta);

  if (r.url) {
    const link = document.createElement('a');
    link.className = 'prc-permalink';
    link.href = r.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '↗';
    header.appendChild(link);
  }

  card.appendChild(header);

  if (r.body && r.body.trim()) {
    const bodyEl = document.createElement('div');
    bodyEl.className = 'prc-comment-body';
    bodyEl.innerHTML = renderMd(r.body);
    card.appendChild(bodyEl);
  }

  return card;
}

/* ── Build UI: issue comment card ──────────────────────────────────── */

function buildIssueCommentCard(ic) {
  const card = document.createElement('div');
  card.className = 'prc-comment-card';

  const header = document.createElement('div');
  header.className = 'prc-comment-header';

  if (ic.author_avatar) {
    const img = document.createElement('img');
    img.className = 'prc-avatar';
    img.src = ic.author_avatar;
    img.alt = ic.author;
    img.width = 20;
    img.height = 20;
    header.appendChild(img);
  }

  const meta = document.createElement('span');
  meta.className = 'prc-meta';
  meta.innerHTML = `<strong>${escapeHtml(ic.author)}</strong> <span class="prc-date">${formatDate(ic.created_at)}</span>`;
  header.appendChild(meta);

  if (ic.url) {
    const link = document.createElement('a');
    link.className = 'prc-permalink';
    link.href = ic.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = '↗';
    header.appendChild(link);
  }

  card.appendChild(header);

  if (ic.body) {
    const body = document.createElement('div');
    body.className = 'prc-comment-body';
    body.innerHTML = renderMd(ic.body);
    card.appendChild(body);
  }

  return card;
}

/* ── Styles ──────────────────────────────────────────────────────────── */

const STYLES = `
  :host {
    display: block;
  }

  .prc-group {
    max-width: 100%;
    overflow: hidden;
  }

  .prc-comment-card {
    position: relative;
    padding: 6px 8px;
    margin: 4px 0;
    background: var(--myst-color-surface, #fff);
    border: 1px solid var(--myst-color-border, #e5e7eb);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
    max-width: 100%;
    overflow: hidden;
  }
  .prc-comment-card:hover {
    border-color: var(--myst-color-link, #2563eb);
  }

  .prc-review-card {
    position: relative;
    padding: 6px 8px;
    margin: 4px 0;
    background: var(--myst-color-surface, #fff);
    border: 1px solid var(--myst-color-border, #e5e7eb);
    border-radius: 4px;
    font-size: 12px;
    line-height: 1.5;
  }

  .prc-comment-header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 4px;
  }
  .prc-avatar {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .prc-meta {
    font-size: 11px;
    color: var(--myst-color-text-secondary, #6b7280);
    flex: 1;
  }
  .prc-meta strong {
    color: var(--myst-color-text, #1f2937);
  }
  .prc-date {
    color: var(--myst-color-text-secondary, #9ca3af);
  }

  .prc-comment-body {
    font-size: 12px;
    line-height: 1.5;
    word-break: break-word;
    overflow-wrap: anywhere;
    color: var(--myst-color-text, #1f2937);
    max-width: 100%;
  }

  .prc-suggestion {
    margin: 6px 0 2px;
    border-left: 3px solid #22c55e;
    border-radius: 3px;
    overflow: hidden;
  }
  .prc-suggestion-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 1px 6px;
    background: #dcfce7;
    color: #166534;
  }
  .prc-suggestion-code {
    margin: 0;
    padding: 4px 6px;
    background: #f0fdf4;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 11px;
    overflow-x: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    max-width: 100%;
  }

  .prc-code-block {
    background: var(--myst-color-bg-alt, #f6f8fa);
    border: 1px solid var(--myst-color-border, #d0d7de);
    border-radius: 4px;
    padding: 4px 6px;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 11px;
    margin: 4px 0;
    max-width: 100%;
  }
  .prc-inline-code {
    background: var(--myst-color-bg-alt, #eff1f3);
    padding: 0 3px;
    border-radius: 2px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 11px;
  }
  .prc-mention {
    font-weight: 500;
    color: var(--myst-color-link, #2563eb);
  }

  .prc-permalink {
    font-size: 12px;
    text-decoration: none;
    color: var(--myst-color-text-secondary, #9ca3af);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .prc-comment-card:hover .prc-permalink,
  .prc-review-card:hover .prc-permalink {
    opacity: 0.6;
  }
  .prc-permalink:hover {
    opacity: 1 !important;
    color: var(--myst-color-link, #2563eb);
  }

  .prc-file-badge {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 10px;
    background: var(--myst-color-bg-alt, #f3f4f6);
    padding: 1px 4px;
    border-radius: 3px;
  }
`;

/* ── Widget ──────────────────────────────────────────────────────────── */

function render({ model, el }) {
  const mode = model.get('mode') || 'inline';
  const comments = model.get('comments') || [];
  const reviews = model.get('reviews') || [];
  const issueComments = model.get('issue_comments') || [];

  const group = document.createElement('div');
  group.className = 'prc-group';

  if (mode === 'inline') {
    // Render comment cards for this line
    // Group into threads (replies indented under parent)
    const roots = comments.filter(c => !c.in_reply_to_id);
    const replies = comments.filter(c => c.in_reply_to_id);

    for (const root of roots) {
      group.appendChild(buildCommentCard(root));
      const threadReplies = replies.filter(r => r.in_reply_to_id === root.id);
      for (const reply of threadReplies) {
        const card = buildCommentCard(reply);
        card.style.marginLeft = '12px';
        group.appendChild(card);
      }
    }

    // Also include orphan replies (replying to comments not in this set)
    const orphanReplies = replies.filter(
      r => !roots.find(rt => rt.id === r.in_reply_to_id)
    );
    for (const reply of orphanReplies) {
      const card = buildCommentCard(reply);
      card.style.marginLeft = '12px';
      group.appendChild(card);
    }
  } else if (mode === 'meta') {
    // Render reviews
    for (const r of reviews) {
      group.appendChild(buildReviewCard(r));
    }
    // Render issue comments
    for (const ic of issueComments) {
      group.appendChild(buildIssueCommentCard(ic));
    }
  }

  if (group.children.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'prc-meta';
    empty.textContent = 'No comments.';
    group.appendChild(empty);
  }

  el.appendChild(group);
}

/* ── Scroll-to listener ─────────────────────────────────────────────── */
/* (kept for future use — margin asides are already next to their targets) */

function initialize({ model }) {
  // No-op for now — comments are placed as margin asides next to their targets
}

export default { render, initialize };