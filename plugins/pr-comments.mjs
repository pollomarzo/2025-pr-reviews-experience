import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function buildLineMap(node, entries = []) {
  for (let i = 0; i < (node.children?.length ?? 0); i++) {
    const child = node.children[i];
    const line = child.position?.start?.line;
    if (line && (child.type === 'paragraph' || child.type === 'heading'))
      entries.push({ line, parent: node, idx: i });
    buildLineMap(child, entries);
  }
  return entries.sort((a, b) => a.line - b.line);
}

function nearestEntry(map, target) {
  return map.reduce((best, e) => (e.line <= target ? e : best), null);
}

function marker(comments) {
  return {
    type: 'anywidget',
    esm: './plugins/pr-comments-widget.mjs',
    model: {
      comments: comments.map(({ id, author, author_avatar, body, in_reply_to_id, created_at, submitted_at, url }) =>
        ({ id, author, author_avatar, body, in_reply_to_id, created_at: created_at ?? submitted_at, url })
      ),
    },
  };
}

function isMain(mdast) {
  let count = 0;
  function walk(n) {
    if ((n.type === 'paragraph' || n.type === 'heading') && n.position?.start?.line) count++;
    n.children?.forEach(walk);
  }
  walk(mdast);
  return count >= 3 && (mdast.children ?? []).some(n => n.type === 'block' && !n.data?.part);
}

const transform = {
  name: 'pr-comments',
  stage: 'document',
  plugin: () => (mdast) => {
    let data;
    try { data = JSON.parse(readFileSync(join(__dirname, '..', 'pr-comments-data.json'), 'utf-8')); }
    catch { return; }

    if (!isMain(mdast)) return;

    const { comments = [], reviews = [], issue_comments: issueComments = [] } = data;
    const block = (mdast.children ?? []).find(n => n.type === 'block' && !n.data?.part);
    if (!block) return;

    const lineMap = buildLineMap(mdast);

    // Group inline comments by target line
    const byLine = {};
    for (const c of comments.filter(c => c.path === 'index.md' && c.line))
      (byLine[c.line] ??= []).push(c);

    // Insert markers before target paragraphs; reverse order preserves indices
    Object.entries(byLine)
      .map(([line, cs]) => ({ entry: nearestEntry(lineMap, +line), cs }))
      .filter(({ entry }) => entry)
      .sort((a, b) => b.entry.idx - a.entry.idx)
      .forEach(({ entry, cs }) => {
        const roots = cs.filter(c => !c.in_reply_to_id);
        const thread = roots.flatMap(r => [r, ...cs.filter(c => c.in_reply_to_id === r.id)]);
        entry.parent.children.splice(entry.idx, 0, marker(thread));
      });

    // Reviews + issue comments as a single marker at the top
    if (reviews.length || issueComments.length)
      block.children.unshift(marker([...reviews, ...issueComments]));
  },
};

export default { name: 'PR Review Comments', transforms: [transform] };
