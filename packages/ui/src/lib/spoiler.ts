import type { InlineNode, MarkdownExtension, TextNode } from "@tanstack/markdown";

const MARKER = "||";
export const SPOILER_TAG = "bogey-spoiler";

type Piece = InlineNode | typeof MARKER;

function pieces(nodes: Tuple<InlineNode>): Piece[] {
  return nodes.flatMap((node): Piece[] => {
    if (node.type !== "text") return [withSpoilers(node)];
    return node.value.split(MARKER).flatMap((value, index): Piece[] => {
      const text: TextNode[] = value ? [{ type: "text", value }] : [];
      return index === 0 ? text : [MARKER, ...text];
    });
  });
}

function withSpoilers(node: InlineNode): InlineNode {
  if (!("children" in node)) return node;
  return { ...node, children: spoilers(node.children) };
}

function spoilers(nodes: Tuple<InlineNode>): InlineNode[] {
  const list = pieces(nodes);
  const out: InlineNode[] = [];
  for (let index = 0; index < list.length; index++) {
    const piece = list[index]!;
    if (piece !== MARKER) {
      out.push(piece);
      continue;
    }
    const close = list.indexOf(MARKER, index + 1);
    const inner = list
      .slice(index + 1, close)
      .filter((item): item is InlineNode => item !== MARKER);
    if (close === -1 || inner.length === 0) {
      out.push({ type: "text", value: close === -1 ? MARKER : MARKER + MARKER });
      if (close !== -1) index = close;
      continue;
    }
    out.push({
      type: "inlineComponent",
      name: "spoiler",
      tagName: SPOILER_TAG,
      attributes: {},
      children: inner,
    });
    index = close;
  }
  return out;
}

export function spoilerExtension(): MarkdownExtension {
  return { name: "spoiler", transformInline: (nodes) => spoilers(nodes) };
}
