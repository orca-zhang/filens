import { useMemo, useState } from 'react';

interface ReadingItem {
  id: string;
  title: string;
  finished: boolean;
}

export function ReadingList({ items }: { items: readonly ReadingItem[] }) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const visible = useMemo(
    () => items.filter(item => !onlyUnread || !item.finished),
    [items, onlyUnread]
  );

  return (
    <section aria-labelledby="reading-title">
      <h2 id="reading-title">下一本，读什么？</h2>
      <label>
        <input type="checkbox" checked={onlyUnread}
          onChange={event => setOnlyUnread(event.target.checked)} />
        只显示未读
      </label>
      <ul>
        {visible.map(item => (
          <li key={item.id}>
            <span>{item.title}</span>
            {item.finished && <small>已读完</small>}
          </li>
        ))}
      </ul>
      {!visible.length && <p>留一点空白，给下一次发现。</p>}
    </section>
  );
}
