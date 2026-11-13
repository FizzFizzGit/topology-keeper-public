// 小さなMarkdown風書式を標準DOMへ描画する。Obsidian独自のcreateEl等は使用しない。
// 入力は説明文、出力はparent内の追記DOM。HTMLとして解釈しないため、タグも文字として表示。
// 対応: 段落、- の箇条書き、### の小見出し、**太字**。リンクや入れ子リストは非対応。
function renderInfoContent(parent, text) {
  const append = (element, tag, value) => {
    const child = parent.ownerDocument.createElement(tag);
    if (value !== undefined) child.textContent = value;
    element.appendChild(child);
    return child;
  };
  const inline = (element, value) => {
    for (const [index, part] of value.split('**').entries()) {
      append(element, index % 2 ? 'strong' : 'span', part);
    }
  };
  let list = null;
  let paragraph = null;
  for (const line of text.split('\n')) {
    const value = line.trim();
    if (!value) { list = null; paragraph = null; continue; }
    if (value.startsWith('- ')) {
      list ??= append(parent, 'ul');
      inline(append(list, 'li'), value.slice(2));
      paragraph = null;
    } else {
      list = null;
      if (value.startsWith('### ')) {
        inline(append(parent, 'h4'), value.slice(4));
        paragraph = null;
      } else {
        if (paragraph) append(paragraph, 'span', ' ');
        paragraph ??= append(parent, 'p');
        inline(paragraph, value);
      }
    }
  }
}

module.exports = { renderInfoContent };
