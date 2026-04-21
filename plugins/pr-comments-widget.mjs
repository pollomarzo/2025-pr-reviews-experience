const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = iso => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return ''; } };

function renderBody(text) {
  if (!text) return '';
  // Split out suggestion blocks so they're handled separately from regular markdown
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

function buildCard(c) {
  const el = document.createElement('div');
  el.className = 'prc-card' + (c.in_reply_to_id ? ' prc-reply' : '');
  el.innerHTML = `
    <div class="prc-header">
      ${c.author_avatar ? `<img class="prc-avatar" src="${esc(c.author_avatar)}" alt="${esc(c.author)}">` : ''}
      <span><strong>${esc(c.author)}</strong> <span class="prc-date">${fmtDate(c.created_at)}</span></span>
      ${c.url ? `<a class="prc-link" href="${esc(c.url)}" target="_blank" rel="noopener">↗</a>` : ''}
    </div>
    <div class="prc-body">${renderBody(c.body)}</div>
  `;
  return el;
}

function showPopup(anchor, comments) {
  document.querySelector('.prc-popup')?.remove();

  const popup = document.createElement('div');
  popup.className = 'prc-popup';
  const { bottom, right } = anchor.getBoundingClientRect();
  popup.style.cssText = `top:${bottom + 6}px;right:${Math.max(window.innerWidth - right, 8)}px`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'prc-close';
  closeBtn.textContent = '×';
  closeBtn.onclick = () => popup.remove();
  popup.appendChild(closeBtn);

  comments.forEach(c => popup.appendChild(buildCard(c)));
  document.body.appendChild(popup);

  // Dismiss on outside click
  setTimeout(() => document.addEventListener('click', e => {
    if (!popup.contains(e.target)) popup.remove();
  }, { once: true }), 0);
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
    position: fixed; z-index: 9999;
    background: white; border: 1px solid #e5e7eb; border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,.12);
    min-width: 280px; max-width: 420px; max-height: 60vh; overflow-y: auto;
    padding: 12px; font-size: 13px; line-height: 1.5;
  }
  .prc-close {
    float: right; background: none; border: none; font-size: 18px;
    cursor: pointer; color: #9ca3af; padding: 0 2px; line-height: 1;
  }
  .prc-close:hover { color: #374151; }

  .prc-card { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px solid #f3f4f6; }
  .prc-card:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
  .prc-reply { margin-left: 12px; border-left: 2px solid #e5e7eb; padding-left: 8px; }

  .prc-header { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 12px; }
  .prc-avatar { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; }
  .prc-date { color: #9ca3af; }
  .prc-link { margin-left: auto; color: #9ca3af; text-decoration: none; font-size: 11px; }
  .prc-link:hover { color: #3b82f6; }

  .prc-body { word-break: break-word; }
  .prc-body code { background: #f6f8fa; padding: 0 3px; border-radius: 2px; font-family: monospace; font-size: 11px; }
  .prc-body pre { background: #f6f8fa; padding: 8px; border-radius: 4px; overflow-x: auto; font-size: 11px; margin: 6px 0; }
  .prc-body pre code { background: none; padding: 0; }

  .prc-sug { border-left: 3px solid #22c55e; margin: 6px 0; border-radius: 0 3px 3px 0; overflow: hidden; }
  .prc-sug-label { font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 2px 6px; background: #dcfce7; color: #166534; }
  .prc-sug pre { margin: 0; padding: 6px; background: #f0fdf4; font-size: 11px; white-space: pre-wrap; overflow-wrap: anywhere; }
`;

let stylesInjected = false;

function render({ model, el }) {
  if (!stylesInjected) {
    document.head.insertAdjacentHTML('beforeend', `<style>${STYLES}</style>`);
    stylesInjected = true;
  }

  const comments = model.get('comments') || [];
  (el.parentElement ?? el).style.cssText = 'float: right; margin: 0 0 4px 8px; line-height: 1;';

  const btn = document.createElement('button');
  btn.className = 'prc-trigger';
  btn.title = `${comments.length} comment${comments.length !== 1 ? 's' : ''}`;
  btn.textContent = `💬 ${comments.length}`;
  btn.onclick = e => { e.stopPropagation(); showPopup(btn, comments); };
  el.appendChild(btn);
}

export default { render };
