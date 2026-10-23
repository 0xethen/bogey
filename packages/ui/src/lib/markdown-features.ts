import type {
  BlockNode,
  InlineNode,
  ListNode,
  MarkdownDocument,
  MarkdownExtension,
} from "@tanstack/markdown";
import type { MarkdownFeatures } from "@bogey/utils/markdown";

const UNDERLINE = /^\+\+(?=\S)([\s\S]*?\S)\+\+(?!\+)/;

/** `++text++` renders as `<u>`; a `++` right after a letter or digit (C++) stays as typed. */
export function underlineExtension(): MarkdownExtension {
  return {
    name: "underline",
    inlineParser: {
      markers: "+",
      parse({ source, index, parseInline }) {
        if (/[\p{L}\p{N}+]/u.test(source[index - 1] ?? "")) return undefined;
        const match = UNDERLINE.exec(source.slice(index));
        if (!match) return undefined;
        return {
          node: {
            type: "inlineComponent",
            name: "underline",
            tagName: "u",
            attributes: {},
            children: parseInline(match[1]!),
          },
          length: match[0].length,
        };
      },
    },
  };
}

const text = (value: string): InlineNode => ({ type: "text", value });

function plainInline(nodes: Tuple<InlineNode>, features: MarkdownFeatures): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    if (node.type === "link" && !features.links) {
      const children = plainInline(node.children, features);
      const label = children.length === 1 && children[0]?.type === "text" ? children[0].value : "";
      if (label === node.href || `mailto:${label}` === node.href) return children;
      return [text("["), ...children, text(`](${node.href})`)];
    }
    if (node.type === "image" && !features.images) return [text(`![${node.alt}](${node.src})`)];
    if (node.type === "inlineCode" && !features.code) return [text(`\`${node.value}\``)];
    if ("children" in node) return [{ ...node, children: plainInline(node.children, features) }];
    return [node];
  });
}

function prefixed(blocks: BlockNode[], prefix: string): BlockNode[] {
  const [first, ...rest] = blocks;
  if (first?.type !== "paragraph")
    return [{ type: "paragraph", children: [text(prefix)] }, ...blocks];
  return [{ ...first, children: [text(prefix), ...first.children] }, ...rest];
}

function plainList(list: ListNode, features: MarkdownFeatures): BlockNode[] {
  return list.items.flatMap((item, index) => {
    const marker = list.ordered ? `${(list.start ?? 1) + index}. ` : "- ";
    return prefixed(plainBlocks(item.children, features), marker);
  });
}

function plainBlocks(blocks: Tuple<BlockNode>, features: MarkdownFeatures): BlockNode[] {
  return blocks.flatMap((block): BlockNode[] => {
    switch (block.type) {
      case "heading": {
        const children = plainInline(block.children, features);
        if (features.headings) return [{ ...block, children }];
        return [
          { type: "paragraph", children: [text(`${"#".repeat(block.depth)} `), ...children] },
        ];
      }
      case "paragraph":
        return [{ ...block, children: plainInline(block.children, features) }];
      case "code": {
        if (features.code) return [block];
        const fence = `\`\`\`${block.lang ?? ""}`;
        const lines = [fence, ...block.value.replace(/\n$/, "").split("\n"), "```"];
        const children = lines.flatMap((line, at): InlineNode[] =>
          at === 0 ? [text(line)] : [{ type: "break" }, text(line)],
        );
        return [{ type: "paragraph", children }];
      }
      case "list":
        if (!features.lists) return plainList(block, features);
        return [
          {
            ...block,
            items: block.items.map((item) => ({
              ...item,
              children: plainBlocks(item.children, features),
            })),
          },
        ];
      case "table":
        return [
          {
            ...block,
            header: block.header.map((cell) => ({
              ...cell,
              children: plainInline(cell.children, features),
            })),
            rows: block.rows.map((row) =>
              row.map((cell) => ({ ...cell, children: plainInline(cell.children, features) })),
            ),
          },
        ];
      case "blockquote":
      case "callout":
      case "component":
        return [{ ...block, children: plainBlocks(block.children, features) }];
      case "footnotes":
        return [
          {
            ...block,
            items: block.items.map((item) => ({
              ...item,
              children: plainBlocks(item.children, features),
            })),
          },
        ];
      default:
        return [block];
    }
  });
}

/** Renders syntax a field doesn't accept as the plain text it was typed as. */
export function restrictMarkdown(
  document: MarkdownDocument,
  features: MarkdownFeatures,
): MarkdownDocument {
  const { headings, ...rest } = document;
  const children = plainBlocks(document.children, features);
  return features.headings && headings ? { ...rest, headings, children } : { ...rest, children };
}

export function featuresExtension(features: MarkdownFeatures): MarkdownExtension {
  return {
    name: "features",
    transformDocument: (document) => restrictMarkdown(document, features),
  };
}
