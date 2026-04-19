/**
 * MyST JavaScript Transform Plugin: PR Review Comments
 *
 * This transform:
 * 1. Reads PR comment data from `pr-comments-data.json`
 * 2. Walks the AST to build a line → node map
 * 3. For each inline comment on the current file, inserts an `aside` node
 *    (kind: 'margin') containing an anywidget right after the target paragraph/heading
 * 4. For reviews and issue comments, inserts a single aside at the top
 * 5. Adds `data-source-line` attributes to content nodes for scroll-to targeting
 *
 * Usage in myst.yml:
 *   project:
 *     plugins:
 *       - plugins/pr-comments.mjs
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/* ── Walk AST ────────────────────────────────────────────────────────── */

function walkNodes(node, visitor) {
  visitor(node);
  if (node.children) {
    for (const child of node.children) {
      walkNodes(child, visitor);
    }
  }
}

/* ── Build line → index mapping into parent's children array ──────── */

function buildLineMap(mdast) {
  // Returns an array of { line, parent, childIndex } for paragraphs/headings
  // that have position info, sorted by line number.
  const entries = [];

  function walk(node) {
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i];
        const line = child.position?.start?.line;
        if (line && (child.type === 'paragraph' || child.type === 'heading')) {
          entries.push({ line, parent: node, childIndex: i });
        }
        walk(child);
      }
    }
  }

  walk(mdast);
  entries.sort((a, b) => a.line - b.line);
  return entries;
}

/* ── Add data-source-line attributes to content nodes ─────────────── */

function addSourceLineAttributes(mdast) {
  walkNodes(mdast, (node) => {
    const line = node.position?.start?.line;
    if (line && (node.type === 'paragraph' || node.type === 'heading')) {
      if (!node.data) node.data = {};
      if (!node.data.sourceLine) node.data.sourceLine = line;
    }
  });
}

/* ── Find the nearest line entry for a target line ──────────────── */

function findNearestEntry(lineMap, targetLine) {
  // Find the entry whose line is closest to (but <=) targetLine
  let best = null;
  for (const entry of lineMap) {
    if (entry.line <= targetLine) {
      best = entry;
    } else {
      break;
    }
  }
  return best;
}

/* ── Check if mdast is the main document content ──────────────────── */

function isMainContentMdast(mdast) {
  let sourceNodeCount = 0;
  let hasNonPartBlock = false;

  walkNodes(mdast, (node) => {
    if ((node.type === 'paragraph' || node.type === 'heading') && node.position?.start?.line) {
      sourceNodeCount++;
    }
    if (node.type === 'block' && !node.data?.part) {
      hasNonPartBlock = true;
    }
  });

  return sourceNodeCount >= 3 && hasNonPartBlock;
}

/* ── Create a compact comment widget model ─────────────────────────── */

function commentModel(comments, reviews, issueComments, prMeta) {
  return {
    pr: prMeta,
    comments: comments.map(c => ({
      id: c.id,
      path: c.path,
      line: c.line,
      author: c.author,
      author_avatar: c.author_avatar,
      body: c.body,
      diff_hunk: c.diff_hunk,
      in_reply_to_id: c.in_reply_to_id,
      created_at: c.created_at,
      url: c.url,
    })),
    reviews: reviews.map(r => ({
      id: r.id,
      author: r.author,
      author_avatar: r.author_avatar,
      body: r.body,
      state: r.state,
      submitted_at: r.submitted_at,
      url: r.url,
    })),
    issue_comments: issueComments.map(ic => ({
      id: ic.id,
      author: ic.author,
      author_avatar: ic.author_avatar,
      body: ic.body,
      created_at: ic.created_at,
      url: ic.url,
    })),
  };
}

/* ── Transform ───────────────────────────────────────────────────────── */

const prCommentsTransform = {
  name: 'pr-comments',
  stage: 'document',
  plugin: (opts, utils) => (mdast) => {
    // Try to load comment data
    let commentData;
    try {
      const dataPath = join(__dirname, '..', 'pr-comments-data.json');
      commentData = JSON.parse(readFileSync(dataPath, 'utf-8'));
    } catch (err) {
      console.warn('[pr-comments] Could not load pr-comments-data.json:', err.message);
      return;
    }

    const comments = commentData.comments || [];
    const reviews = commentData.reviews || [];
    const issueComments = commentData.issue_comments || [];
    const prMeta = commentData.pr || {};

    if (comments.length === 0 && reviews.length === 0 && issueComments.length === 0) {
      return;
    }

    // Only inject into the main document content mdast
    if (!isMainContentMdast(mdast)) {
      return;
    }

    // Add data-source-line attributes for scroll-to targeting
    addSourceLineAttributes(mdast);

    // Build line map: find insertable positions in the content block
    const lineMap = buildLineMap(mdast);

    // Find the main content block (not a part block)
    const root = mdast;
    let block = null;
    for (const child of root.children || []) {
      if (child.type === 'block' && !child.data?.part) {
        block = child;
        break;
      }
    }
    if (!block || !block.children) {
      console.warn('[pr-comments] Could not find content block in AST');
      return;
    }

    const currentFile = 'index.md';

    // ── Inject inline comment asides next to their target paragraphs ──
    // Group comments on this file by target line
    const inlineComments = comments.filter(c => c.path === currentFile && c.line);

    // We need to track insertions to adjust indices as we insert nodes
    // Process lines in reverse order so insertions don't shift subsequent indices
    const commentsByLine = {};
    for (const c of inlineComments) {
      // Group replies under their parent
      const line = c.line;
      if (!commentsByLine[line]) commentsByLine[line] = [];
      commentsByLine[line].push(c);
    }

    // For each line with comments, find the nearest AST node and insert an aside after it
    const insertions = []; // { line, entry, comments }
    for (const [line, lineComments] of Object.entries(commentsByLine)) {
      const entry = findNearestEntry(lineMap, Number(line));
      if (entry) {
        insertions.push({ line: Number(line), entry, comments: lineComments });
      }
    }

    // Sort in reverse order of childIndex so insertions don't shift
    insertions.sort((a, b) => b.entry.childIndex - a.entry.childIndex);

    for (const { line, entry, comments: lineComments } of insertions) {
      // Build a thread: root comments + their replies
      const threadComments = [];
      const roots = lineComments.filter(c => !c.in_reply_to_id);
      for (const root of roots) {
        threadComments.push(root);
        const replies = lineComments.filter(r => r.in_reply_to_id === root.id);
        threadComments.push(...replies);
      }
      // Also include orphan replies (replying to comments not in this set)
      const orphanReplies = lineComments.filter(
        c => c.in_reply_to_id && !roots.find(r => r.id === c.in_reply_to_id)
      );
      threadComments.push(...orphanReplies);

      const asideNode = {
        type: 'aside',
        kind: 'margin',
        children: [
          {
            type: 'admonitionTitle',
            children: [
              { type: 'text', value: `💬 ${threadComments.length} comment${threadComments.length > 1 ? 's' : ''}` },
            ],
          },
          {
            type: 'anywidget',
            esm: './plugins/pr-comments-widget.mjs',
            model: {
              mode: 'inline',
              ...commentModel(threadComments, [], [], prMeta),
            },
          },
        ],
      };

      // Insert after the target node
      const parent = entry.parent;
      const insertIdx = entry.childIndex + 1;
      parent.children.splice(insertIdx, 0, asideNode);
    }

    // ── Inject reviews & issue comments as a single aside at the top ──
    if (reviews.length > 0 || issueComments.length > 0) {
      const topAside = {
        type: 'aside',
        kind: 'margin',
        children: [
          {
            type: 'admonitionTitle',
            children: [
              { type: 'text', value: '📋 PR Review' },
            ],
          },
          {
            type: 'anywidget',
            esm: './plugins/pr-comments-widget.mjs',
            model: {
              mode: 'meta',
              ...commentModel([], reviews, issueComments, prMeta),
            },
          },
        ],
      };
      // Insert at the very top of the content block
      block.children.unshift(topAside);
    }

    console.log(`[pr-comments] Injected ${insertions.length} inline comment groups and ${reviews.length + issueComments.length > 0 ? 1 : 0} meta aside`);
  },
};

const plugin = {
  name: 'PR Review Comments',
  transforms: [prCommentsTransform],
};

export default plugin;