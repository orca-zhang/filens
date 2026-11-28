interface LoneWord { range: Range; start: number; end: number }

/** Find lines without word gaps, where CSS justification falls back to the start edge. */
export function loneVerticalWords(text: HTMLElement, reverse: boolean): LoneWord[] {
  const document = text.ownerDocument;
  const whole = document.createRange();
  whole.selectNodeContents(text);
  if (typeof whole.getClientRects !== 'function' || whole.getClientRects().length < 2) return [];

  const nodes: { text: Node; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const size = node.textContent?.length ?? 0;
    if (size) nodes.push({ text: node, start: offset, end: offset + size });
    offset += size;
  }
  let index = 0;
  const locate = (position: number, end = false) => {
    while (index + 1 < nodes.length && (end ? position > nodes[index].end : position >= nodes[index].end)) index++;
    return nodes[index];
  };
  const box = text.getBoundingClientRect(), words: LoneWord[] = [];
  let line: { left: number; right: number; word: LoneWord; multiple: boolean } | undefined;
  const closeLine = () => { if (line && !line.multiple) words.push(line.word); };
  const split = new Set<Range>();
  for (const match of (text.textContent ?? '').matchAll(/\S+/g)) {
    const start = match.index, end = start + match[0].length;
    const first = locate(start), last = locate(end, true);
    const range = document.createRange();
    range.setStart(first.text, start - first.start);
    range.setEnd(last.text, end - last.start);
    let wordLine: typeof line;
    for (const rect of range.getClientRects()) {
      if (!rect.width || !rect.height) continue;
      const from = reverse ? box.bottom - rect.bottom : rect.top - box.top;
      const to = reverse ? box.bottom - rect.top : rect.bottom - box.top;
      // Adjacent columns' glyph rectangles can overlap by the font's extra leading.
      if (!line || Math.min(rect.right, line.right) - Math.max(rect.left, line.left) < Math.min(rect.width, line.right - line.left) / 2) {
        closeLine();
        line = { left: rect.left, right: rect.right, word: { range, start: from, end: to }, multiple: false };
      } else {
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
        if (line.word.range === range) {
          line.word.start = Math.min(line.word.start, from);
          line.word.end = Math.max(line.word.end, to);
        } else line.multiple = true;
      }
      if (wordLine && wordLine !== line) split.add(range);
      wordLine = line;
    }
  }
  closeLine();
  return words.filter(word => !split.has(word.range));
}

export function centerLoneVerticalWords(words: LoneWord[]): void {
  for (const { range, start, end } of words.reverse()) {
    const word = range.startContainer.ownerDocument!.createElement('span');
    word.style.position = 'relative';
    word.style.insetInlineStart = `calc((100cqh - ${end - start}px) / 2 - ${start}px)`;
    word.append(range.extractContents());
    range.insertNode(word);
  }
}
