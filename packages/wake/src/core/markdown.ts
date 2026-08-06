import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit, SKIP } from 'unist-util-visit';
import type { Root, Text, PhrasingContent, Parent } from 'mdast';
import type { Workspace } from './workspace.js';
import { WIKI_LINK_RE } from './indexer.js';
import type { NodeSummary } from './search.js';

/** Route for a node in the reading UI. */
export function nodeUrl(node: NodeSummary): string {
  switch (node.type) {
    case 'project':
      return `/p/${node.slug}`;
    case 'doc':
      return `/docs/${node.path.replace(/^docs\//, '').replace(/\.md$/, '')}`;
    default:
      return `/i/${node.id}`;
  }
}

function wikiLinks(resolve: (target: string) => NodeSummary | undefined) {
  return () => (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (index === undefined || !parent) return;
      const value = node.value;
      if (!value.includes('[[')) return;
      const parts: PhrasingContent[] = [];
      let last = 0;
      for (const m of value.matchAll(new RegExp(WIKI_LINK_RE.source, 'g'))) {
        const start = m.index!;
        if (start > last) parts.push({ type: 'text', value: value.slice(last, start) });
        const target = m[1].trim();
        const label = m[0].includes('|') ? m[0].slice(2, -2).split('|')[1] : target;
        const resolved = resolve(target);
        if (resolved) {
          parts.push({
            type: 'link',
            url: nodeUrl(resolved),
            data: { hProperties: { className: ['wiki-link'] } },
            children: [{ type: 'text', value: label }],
          });
        } else {
          parts.push({
            type: 'emphasis',
            data: { hName: 'span', hProperties: { className: ['wiki-link', 'wiki-broken'] } },
            children: [{ type: 'text', value: label }],
          });
        }
        last = start + m[0].length;
      }
      if (!parts.length) return;
      if (last < value.length) parts.push({ type: 'text', value: value.slice(last) });
      (parent as Parent).children.splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}

const schema: typeof defaultSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'span'],
  attributes: {
    ...defaultSchema.attributes,
    // the default schema carries a restricted className entry for footnote
    // backrefs — it shadows a permissive one, so replace it outright
    a: [
      ...(defaultSchema.attributes?.a ?? []).filter((x) => !(Array.isArray(x) && x[0] === 'className')),
      'className',
    ] as never,
    span: ['className'] as never,
  },
};

/** Render workspace markdown to sanitized HTML with wiki links resolved against the index. */
export function renderMarkdown(ws: Workspace, markdown: string): string {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(wikiLinks((t) => ws.resolveWikiTarget(t)))
    .use(remarkRehype)
    .use(rehypeSanitize, schema)
    .use(rehypeStringify);
  return String(processor.processSync(markdown));
}
