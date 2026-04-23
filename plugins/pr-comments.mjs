import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ESM = './plugins/pr-comments-widget.mjs';

function buildAnchorEntries(node, result = []) {
  for (let i = 0; i < (node.children?.length ?? 0); i++) {
    const child = node.children[i];
    const line = child.position?.start?.line;
    if (line && (child.type === 'paragraph' || child.type === 'heading'))
      result.push({ line, parent: node, idx: i });
    buildAnchorEntries(child, result);
  }
  return result;
}

/** Compute the 0-based line offset for a frontmatter sub-document
 *  so that sub-document line numbers map back to original file lines. */
function computePartOffset(sourcePath, partName) {
  try {
    const lines = readFileSync(sourcePath, 'utf-8').split('\n');
    const re = new RegExp(`^${partName}\\s*:`);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        const afterColon = lines[i].slice(lines[i].indexOf(':') + 1).trim();
        // Inline content on the same line (not a block scalar like | or >)
        if (afterColon && !/^[|>][-+0-9]*\s*$/.test(afterColon)) {
          return i; // mdast line 1 -> original line i+1
        }
        return i + 1; // block scalar: first content line is next line
      }
    }
  } catch {}
  return 0;
}

const transform = {
  name: 'pr-comments',
  stage: 'document',
  plugin: () => (mdast, file) => {
    let config;
    try {
      config = JSON.parse(readFileSync(join(__dirname, '..', 'pr-comments-config.json'), 'utf-8'));
    } catch { return; }

    const currentPath = file?.history?.[0] ?? '';
    const baseName = currentPath.replace(/#parts\..*$/, '').split('/').pop();
    if (baseName !== config.file) return;

    const isMain = !currentPath.includes('#parts.');
    const partMatch = currentPath.match(/#parts\.(.+)$/);
    const partName = partMatch ? partMatch[1] : null;

    const entries = buildAnchorEntries(mdast);

    // Frontmatter sub-documents have reset line numbers; add the original offset.
    if (partName) {
      const sourcePath = join(file.cwd, config.file);
      const offset = computePartOffset(sourcePath, partName);
      for (const e of entries) {
        e.line += offset;
      }
    }

    // Inject anchor widgets in reverse document order to preserve splice indices
    [...entries].sort((a, b) => b.line - a.line).forEach(({ parent, idx, line }) => {
      parent.children.splice(idx+1, 0, {
        type: 'anywidget',
        esm: ESM,
        model: { type: 'anchor', line },
      });
    });

    // Only inject the root widget into the main body document
    if (!isMain) return;

    const block = (mdast.children ?? []).find(n => n.type === 'block' && !n.data?.part);
    if (!block) return;

    const pr = process.env.PR_NUMBER || null;
    const slug = config.slug ?? (config.file ?? 'index.md').replace(/\.md$/, '');

    block.children.unshift({
      type: 'anywidget',
      esm: ESM,
      model: { type: 'root', repo: config.repo, file: config.file ?? 'index.md', pr, dataUrl: `./${slug}.json` },
    });
  },
};

export default { name: 'PR Review Comments', transforms: [transform] };
