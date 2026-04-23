const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); } catch { return ''; } };
const TOKEN_KEY = 'prc_github_token';

// Shared across all widget instances on the page.
// The root widget resolves this with { [anchorLine]: Comment[] }.
// Anchor widgets wait on it to decide whether to show a badge.
let resolveAssignments;
const assignmentsReady = new Promise(r => { resolveAssignments = r; });

function nearestAnchor(sortedLines, commentLine) {
  return sortedLines.filter(l => l <= commentLine).at(-1) ?? sortedLines[0];
}

function buildAssignments(inlineComments, anchorLines) {
  const sorted = [...anchorLines].sort((a, b) => a - b);
  const assignments = {};
  for (const c of inlineComments) {
    if (!c.line) continue;
    const anchor = nearestAnchor(sorted, c.line);
    (assignments[anchor] ??= []).push(c);
  }
  return assignments;
}

function extractAnchorLines(pageData) {
  const lines = [];
  const seen = new Set();

  function walk(node) {
    if (node.type === 'anywidget' && node.model?.type === 'anchor' && typeof node.model.line === 'number') {
      if (!seen.has(node.model.line)) {
        seen.add(node.model.line);
        lines.push(node.model.line);
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }

  if (pageData.mdast) walk(pageData.mdast);
  if (pageData.frontmatter?.parts) {
    for (const part of Object.values(pageData.frontmatter.parts)) {
      if (part.mdast) walk(part.mdast);
    }
  }

  return lines.sort((a, b) => a - b);
}

function renderBody(text) {
  if (!text) return '';
  return text.split(/(```suggestion\n[\s\S]*?```)/g).map(part => {
    const m = part.match(/^```suggestion\n([\s\S]*?)```$/);
    if (m) return `<div class="prc-sug"><div class="prc-sug-label">Suggestion</div><pre>${esc(m[1].trimEnd())}</pre></div>`;
    let h = esc(part);
    h = h.replace(/```\w*\n([\s\S]*?)```/g, (_, c) => `<pre><code>${c.trim()}</code></pre>`);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\n/g, '<br>');
    return h;
  }).join('');
}

function cardHtml(c) {
  return `
    <div class="prc-card${c.in_reply_to_id ? ' prc-reply' : ''}">
      <div class="prc-header">
        ${c.author_avatar ? `<img class="prc-avatar" src="${esc(c.author_avatar)}" alt="${esc(c.author)}">` : ''}
        <span><strong>${esc(c.author)}</strong> <span class="prc-date">${fmtDate(c.created_at)}</span></span>
        ${c.url ? `<a class="prc-link" href="${esc(c.url)}" target="_blank" rel="noopener">↗</a>` : ''}
      </div>
      ${c.path ? `<div class="prc-path">${esc(c.path)}${c.line ? ':' + c.line : ''}</div>` : ''}
      <div class="prc-body">${renderBody(c.body)}</div>
    </div>
  `;
}

async function fetchPR(repo, pr, token) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const base = `https://api.github.com/repos/${repo}`;

  const [inlineRes, reviewsRes, issueRes] = await Promise.all([
    fetch(`${base}/pulls/${pr}/comments`, { headers }),
    fetch(`${base}/pulls/${pr}/reviews`, { headers }),
    fetch(`${base}/issues/${pr}/comments`, { headers }),
  ]);

  if (!inlineRes.ok) throw new Error(
    inlineRes.status === 403
      ? 'Rate limited — add a GitHub token below'
      : `GitHub API error ${inlineRes.status}`,
  );

  const [inline, reviews, issue] = await Promise.all([
    inlineRes.json(), reviewsRes.json(), issueRes.json(),
  ]);

  return {
    inline: inline.map(c => ({
      id: c.id,
      author: c.user.login,
      author_avatar: c.user.avatar_url,
      body: c.body,
      in_reply_to_id: c.in_reply_to_id ?? null,
      created_at: c.created_at,
      url: c.html_url,
      path: c.path,
      line: c.line ?? c.original_line ?? null,
    })),
    reviews: reviews.filter(r => r.body?.trim()).map(r => ({
      id: r.id, author: r.user.login, author_avatar: r.user.avatar_url,
      body: r.body, created_at: r.submitted_at, url: r.html_url,
    })),
    issue: issue.map(c => ({
      id: c.id, author: c.user.login, author_avatar: c.user.avatar_url,
      body: c.body, created_at: c.created_at, url: c.html_url,
    })),
  };
}

function showPopup(anchor, comments) {
  document.querySelector('.prc-popup')?.remove();
  const popup = document.createElement('div');
  popup.className = 'prc-popup';
  const { bottom, right } = anchor.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  popup.style.cssText = `top:${bottom + scrollTop + 6}px;right:${Math.max(window.innerWidth - right, 8)}px`;

  const close = document.createElement('button');
  close.className = 'prc-popup-close';
  close.textContent = '×';
  close.onclick = () => popup.remove();
  popup.appendChild(close);

  const roots = comments.filter(c => !c.in_reply_to_id);
  roots.forEach(r => {
    popup.insertAdjacentHTML('beforeend', cardHtml(r));
    comments.filter(c => c.in_reply_to_id === r.id).forEach(c =>
      popup.insertAdjacentHTML('beforeend', cardHtml(c))
    );
  });

  document.body.appendChild(popup);
  setTimeout(() => document.addEventListener('click', e => {
    if (!popup.contains(e.target)) popup.remove();
  }, { once: true }), 0);
}

function panelContent({ inline, reviews, issue }) {
  if (!inline.length && !reviews.length && !issue.length)
    return '<p class="prc-empty">No comments on this PR.</p>';
  let html = '';
  if (inline.length) {
    const roots = inline.filter(c => !c.in_reply_to_id);
    html += `<div class="prc-section-label">Inline (${inline.length})</div>`;
    roots.forEach(r => {
      html += cardHtml(r);
      inline.filter(c => c.in_reply_to_id === r.id).forEach(c => { html += cardHtml(c); });
    });
  }
  const general = [...reviews, ...issue];
  if (general.length) {
    html += `<div class="prc-section-label">General (${general.length})</div>`;
    general.forEach(c => { html += cardHtml(c); });
  }
  return html;
}

const STYLES = `
  .prc-trigger {
    background: none; border: 1px solid #d1d5db; border-radius: 12px;
    padding: 2px 8px; font-size: 12px; cursor: pointer; color: #6b7280;
    display: inline-flex; align-items: center; gap: 4px; transition: all 0.15s;
    white-space: nowrap;
  }
  .prc-trigger:hover { border-color: #3b82f6; color: #3b82f6; background: #eff6ff; }

  .prc-popup {
    position: absolute; z-index: 9999;
    background: white; border: 1px solid #e5e7eb; border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,.12);
    min-width: 280px; max-width: 420px; max-height: 60vh; overflow-y: auto;
    padding: 12px; font-size: 13px; line-height: 1.5; font-family: system-ui, sans-serif;
  }
  .prc-popup-close {
    float: right; background: none; border: none; font-size: 18px;
    cursor: pointer; color: #9ca3af; padding: 0 2px; line-height: 1;
  }
  .prc-popup-close:hover { color: #374151; }

  .prc-fab {
    position: fixed; bottom: 24px; right: 24px; z-index: 9000;
    width: 48px; height: 48px; border-radius: 50%;
    background: #2563eb; color: white; border: none; font-size: 18px; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.25);
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s, box-shadow 0.15s;
  }
  .prc-fab:hover { transform: scale(1.08); box-shadow: 0 4px 14px rgba(0,0,0,.3); }
  .prc-fab-badge {
    position: absolute; top: -4px; right: -4px;
    background: #ef4444; color: white; border-radius: 10px;
    font-size: 10px; font-weight: 700; padding: 1px 5px;
    line-height: 1.4; min-width: 16px; text-align: center;
  }

  .prc-panel {
    position: fixed; top: 0; right: 0; z-index: 8999;
    width: 360px; max-width: 100vw; height: 100dvh;
    background: white; border-left: 1px solid #e5e7eb;
    box-shadow: -4px 0 24px rgba(0,0,0,.1);
    display: flex; flex-direction: column;
    transform: translateX(100%); transition: transform 0.25s ease;
    font-size: 13px; line-height: 1.5; font-family: system-ui, sans-serif;
  }
  .prc-panel.prc-open { transform: translateX(0); }
  .prc-panel-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border-bottom: 1px solid #e5e7eb;
    font-weight: 600; font-size: 14px; flex-shrink: 0;
  }
  .prc-panel-header a { color: #6b7280; font-size: 12px; font-weight: 400; text-decoration: none; }
  .prc-panel-header a:hover { color: #2563eb; }
  .prc-close { background: none; border: none; cursor: pointer; color: #9ca3af; font-size: 20px; padding: 0 2px; line-height: 1; }
  .prc-close:hover { color: #374151; }
  .prc-panel-body { flex: 1; overflow-y: auto; padding: 12px 16px; }
  .prc-panel-footer {
    padding: 10px 16px; border-top: 1px solid #e5e7eb;
    flex-shrink: 0; display: flex; flex-direction: column; gap: 4px;
  }
  .prc-token-input {
    width: 100%; box-sizing: border-box;
    border: 1px solid #d1d5db; border-radius: 4px; padding: 5px 8px; font-size: 12px;
  }
  .prc-token-input:focus { outline: none; border-color: #2563eb; }
  .prc-token-hint { font-size: 11px; color: #9ca3af; }

  .prc-section-label {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    color: #6b7280; margin: 12px 0 6px; letter-spacing: 0.05em;
  }
  .prc-section-label:first-child { margin-top: 0; }
  .prc-card { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #f3f4f6; }
  .prc-card:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
  .prc-reply { margin-left: 12px; border-left: 2px solid #e5e7eb; padding-left: 8px; }
  .prc-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
  .prc-avatar { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; }
  .prc-date { color: #9ca3af; font-size: 11px; }
  .prc-link { margin-left: auto; color: #9ca3af; text-decoration: none; font-size: 11px; }
  .prc-link:hover { color: #2563eb; }
  .prc-path { font-size: 11px; color: #6b7280; font-family: monospace; margin-bottom: 3px; }
  .prc-body { word-break: break-word; }
  .prc-body code { background: #f6f8fa; padding: 0 3px; border-radius: 2px; font-family: monospace; font-size: 11px; }
  .prc-body pre { background: #f6f8fa; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 11px; margin: 6px 0; }
  .prc-body pre code { background: none; padding: 0; }
  .prc-sug { border-left: 3px solid #22c55e; margin: 6px 0; border-radius: 0 3px 3px 0; overflow: hidden; }
  .prc-sug-label { font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 2px 6px; background: #dcfce7; color: #166534; }
  .prc-sug pre { margin: 0; padding: 6px; background: #f0fdf4; font-size: 11px; white-space: pre-wrap; }
  .prc-loading { text-align: center; padding: 32px; color: #9ca3af; }
  .prc-error { padding: 12px; background: #fef2f2; border-radius: 6px; color: #991b1b; font-size: 12px; }
  .prc-empty, .prc-no-pr { color: #6b7280; font-size: 12px; padding: 8px 0; }
  .prc-no-pr code { background: #f6f8fa; padding: 1px 4px; border-radius: 3px; font-family: monospace; font-size: 11px; }
`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || document.getElementById('prc-styles')) { stylesInjected = true; return; }
  stylesInjected = true;
  const s = document.createElement('style');
  s.id = 'prc-styles';
  s.textContent = STYLES;
  document.head.appendChild(s);
}

function renderRoot({ model, el }) {
  injectStyles();

  const repo = model.get('repo');
  const file = model.get('file') ?? 'index.md';
  const pr = model.get('pr');

  const fab = document.createElement('button');
  fab.className = 'prc-fab';
  fab.title = pr ? `PR #${pr} comments` : 'No PR configured';
  fab.innerHTML = `💬<span class="prc-fab-badge">${pr ? '…' : '?'}</span>`;
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.className = 'prc-panel';
  const prLink = pr && repo
    ? `<a href="https://github.com/${esc(repo)}/pull/${esc(pr)}" target="_blank" rel="noopener">#${esc(pr)} ↗</a>`
    : '';
  panel.innerHTML = `
    <div class="prc-panel-header">
      <span>PR Review ${prLink}</span>
      <button class="prc-close">×</button>
    </div>
    <div class="prc-panel-body">
      ${pr ? '<div class="prc-loading">Loading…</div>'
           : '<p class="prc-no-pr">No PR number configured at build time. Set the <code>PR_NUMBER</code> environment variable before building.</p>'}
    </div>
    <div class="prc-panel-footer">
      <input class="prc-token-input" type="password"
        placeholder="GitHub token (optional, for private repos or rate limits)"
        value="${esc(localStorage.getItem(TOKEN_KEY) || '')}">
      <span class="prc-token-hint">Unauthenticated: 60 req/hr · Authenticated: 5000 req/hr</span>
    </div>
  `;
  document.body.appendChild(panel);

  const badge = fab.querySelector('.prc-fab-badge');
  const body = panel.querySelector('.prc-panel-body');
  const tokenInput = panel.querySelector('.prc-token-input');

  fab.onclick = () => panel.classList.toggle('prc-open');
  panel.querySelector('.prc-close').onclick = () => panel.classList.remove('prc-open');

  async function load() {
    if (!pr) { resolveAssignments({}); return; }

    let anchorLines = [];
    const dataUrl = model.get('dataUrl');
    if (dataUrl) {
      try {
        const pageData = await fetch(dataUrl).then(r => r.json());
        anchorLines = extractAnchorLines(pageData);
      } catch (err) {
        console.warn('Failed to discover anchors from page data:', err);
        anchorLines = model.get('anchorLines') ?? [];
      }
    } else {
      anchorLines = model.get('anchorLines') ?? [];
    }

    body.innerHTML = '<div class="prc-loading">Loading…</div>';
    const token = localStorage.getItem(TOKEN_KEY) || '';
    try {
      const data = await fetchPR(repo, pr, token);
      const total = data.inline.length + data.reviews.length + data.issue.length;
      badge.textContent = String(total);
      body.innerHTML = panelContent(data);
      resolveAssignments(buildAssignments(
        data.inline.filter(c => c.path === file),
        anchorLines,
      ));
    } catch (err) {
      badge.textContent = '!';
      body.innerHTML = `<div class="prc-error">${esc(err.message)}</div>`;
      resolveAssignments({});
    }
  }

  tokenInput.addEventListener('change', () => {
    localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
    load();
  });

  load();
}

function renderAnchor({ model, el }) {
  // .myst-anywidget host is display:contents by default (see pr-comments.css),
  // so empty anchors take no block space. When comments arrive, override via
  // inline style on whatever element we can reach outside the shadow root.
  const myLine = model.get('line');
  assignmentsReady.then(assignments => {
    const comments = assignments[myLine];
    if (!comments?.length) return;

    injectStyles();

    const rootNode = el.getRootNode();
    const target = rootNode?.host ?? el.parentElement ?? el;

    const btn = document.createElement('button');
    btn.className = 'prc-trigger';
    btn.title = `${comments.length} comment${comments.length !== 1 ? 's' : ''}`;
    btn.textContent = `💬 ${comments.length}`;
    btn.onclick = e => { e.stopPropagation(); showPopup(btn, comments); };
    el.appendChild(btn);
  });
}

function render(context) {
  if (context.model.get('type') === 'anchor') renderAnchor(context);
  else renderRoot(context);
}

export default { render };
