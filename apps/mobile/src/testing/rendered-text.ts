interface TextNode {
  children?: (TextNode | string)[] | null;
}

export function renderedText(tree: TextNode | TextNode[] | null): string {
  const parts: string[] = [];
  const visit = (node: TextNode | string) => {
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    node.children?.forEach(visit);
  };
  [tree ?? []].flat().forEach(visit);
  return parts.join(' ');
}
