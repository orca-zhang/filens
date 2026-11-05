// Group photos by month without changing the source array.
const monthFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: 'long', timeZone: 'Asia/Shanghai'
});

export function createTimeline(photos) {
  const groups = new Map();
  for (const photo of photos) {
    const timestamp = new Date(photo.takenAt);
    if (!Number.isFinite(timestamp.getTime())) continue;
    const key = monthFormatter.format(timestamp);
    const group = groups.get(key) ?? [];
    group.push({ ...photo, timestamp });
    groups.set(key, group);
  }
  return [...groups].map(([month, entries]) => ({
    month,
    entries: entries.sort((a, b) => a.timestamp - b.timestamp)
  }));
}

const photos = [
  { name: '河边的早晨.jpg', takenAt: '2026-10-18T07:25:00+08:00' },
  { name: '旧书店.jpg', takenAt: '2026-10-24T10:00:00+08:00' }
];
console.log(createTimeline(photos));
