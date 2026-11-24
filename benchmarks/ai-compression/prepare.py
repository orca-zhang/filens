"""Lossless structural search and a trained byte-context predictor; no private data."""
import hashlib, json, lzma, math, time, zlib
from pathlib import Path
import numpy as np
import torch

root = Path(__file__).resolve().parents[2]
work = root / 'dist/ai-compression'
meta = json.loads((work / 'extracted.json').read_text())
raw = lzma.decompress((work / 'payload.lzma').read_bytes())
assert len(raw) == meta['size']
assert zlib.crc32(raw) == meta['crc']
(work / 'assets.bin').write_bytes(raw)
assets, offset = [], 0
for kind, size in meta['layout']:
    assets.append(raw[offset:offset + size]); offset += size
assert offset == len(raw)
features = []
for (kind, size), data in zip(meta['layout'], assets):
    values = np.frombuffer(data, dtype=np.uint8)
    histogram = np.bincount(values // 4, minlength=64).astype(float)
    histogram /= max(1, histogram.sum())
    features.append(np.r_[histogram, np.eye(3)[kind] * .25])
features = np.array(features)
features /= np.linalg.norm(features, axis=1, keepdims=True)
centers = [features[np.argmax([len(x) for x in assets])]]
for _ in range(5):
    distance = np.min([np.sum((features - center) ** 2, axis=1) for center in centers], axis=0)
    centers.append(features[np.argmax(distance)])
centers = np.array(centers)
for _ in range(20):
    labels = np.argmin(((features[:, None] - centers) ** 2).sum(axis=2), axis=1)
    for i in range(len(centers)):
        if np.any(labels == i): centers[i] = features[labels == i].mean(axis=0)
clustered = []
for cluster in sorted(set(labels), key=lambda i: -sum(len(assets[j]) for j in np.where(labels == i)[0])):
    remaining = set(np.where(labels == cluster)[0].tolist())
    current = max(remaining, key=lambda i: len(assets[i]))
    while remaining:
        clustered.append(current); remaining.remove(current)
        if remaining: current = min(remaining, key=lambda i: np.linalg.norm(features[current] - features[i]))
orders = {
    'native-original': list(range(len(assets))),
    'kind-size': sorted(range(len(assets)), key=lambda i: (meta['layout'][i][0], -len(assets[i]))),
    'kmeans-neighbors': clustered,
    'size-descending': sorted(range(len(assets)), key=lambda i: -len(assets[i])),
    'reverse': list(reversed(range(len(assets))))
}
plans = []
for name, order in orders.items():
    for pb in ([2, 0] if name in ['native-original', 'kmeans-neighbors'] else [2]):
        started = time.perf_counter()
        joined = b''.join(assets[i] for i in order)
        encoded = lzma.compress(joined, format=lzma.FORMAT_ALONE, filters=[{
            'id': lzma.FILTER_LZMA1, 'dict_size': 1 << 25, 'lc': 3, 'lp': 0, 'pb': pb,
            'mode': lzma.MODE_NORMAL, 'nice_len': 273, 'mf': lzma.MF_BT4}])
        assert lzma.decompress(encoded) == joined
        label = f'{name}-pb{pb}'
        (work / f'{label}.lzma').write_bytes(encoded)
        plan = {'name': label, 'order': order, 'layout': [meta['layout'][i] for i in order],
                'crc': zlib.crc32(joined), 'bytes': len(encoded),
                'encodeMs': (time.perf_counter() - started) * 1000}
        plans.append(plan); print(label, len(encoded), flush=True)
(work / 'plans.json').write_text(json.dumps(plans))

# A trainable one-byte-context softmax model, compiled to deterministic CDFs for deployment.
# Keeping its table explicit avoids requiring PyTorch in the browser decoder.
torch.manual_seed(0); torch.set_num_threads(2)
x = np.frombuffer(raw, dtype=np.uint8).astype(np.int64)
previous = np.r_[0, x[:-1]]
counts_np = np.bincount(previous * 256 + x, minlength=65536).reshape(256, 256)
counts = torch.tensor(counts_np, dtype=torch.float32)
logits = torch.nn.Parameter(torch.zeros(256, 256))
optimizer = torch.optim.Adam([logits], lr=.2)
started = time.perf_counter()
for step in range(120):
    loss = -(counts * torch.log_softmax(logits, dim=1)).sum() / len(raw)
    optimizer.zero_grad(); loss.backward(); optimizer.step()
probabilities = torch.softmax(logits.detach(), dim=1).numpy().astype(np.float64)
scaled = probabilities * (32768 - 256)
frequencies = np.floor(scaled).astype(np.int64) + 1
for row in range(256):
    remainder = 32768 - frequencies[row].sum()
    indices = np.argsort(-(scaled[row] - np.floor(scaled[row])))[:remainder]
    frequencies[row, indices] += 1
assert np.all(frequencies > 0) and np.all(frequencies.sum(axis=1) == 32768)
cdf = np.c_[np.zeros(256, dtype=np.int64), np.cumsum(frequencies, axis=1)].astype('<u2')
(work / 'model.cdf').write_bytes(cdf.tobytes())
model = {'architecture': 'trainable 256-context x 256-byte softmax; one preceding byte; 120 Adam steps',
         'trainingMs': (time.perf_counter() - started) * 1000,
         'trainingBitsPerByte': float(loss.detach()) / math.log(2),
         'quantizedBitsPerByte': float(-(counts_np * np.log2(frequencies / 32768)).sum() / len(raw)),
         'floatWeightsBytes': 256 * 256 * 4, 'deployedModelBytes': len(cdf.tobytes()),
         'deployment': 'quantized CDF table replaces float logits; no PyTorch runtime is shipped'}
(work / 'model.json').write_text(json.dumps(model, indent=2))
print(model, flush=True)
