"""Collect public test data only; never inspect user documents or execute samples."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "benchmarks/format-detection/corpus"
COMMIT = "deb45066a4c6aa7d956011c4b59aad53e426ddac"
URL = f"https://codeload.github.com/sindresorhus/file-type/tar.gz/{COMMIT}"


def fetch():
    folder = BASE / "file-type"
    folder.mkdir(parents=True, exist_ok=True)
    rows = []
    with urlopen(Request(URL, headers={"User-Agent": "filens-format-evaluation"}), timeout=60) as response:
        with tarfile.open(fileobj=response, mode="r|gz") as archive:
            for member in archive:
                parts = member.name.split("/", 1)
                if len(parts) != 2 or not member.isfile():
                    continue
                relative = parts[1]
                if relative.lower() in ("license", "license.md", "license.txt"):
                    (folder / "LICENSE").write_bytes(archive.extractfile(member).read())
                if not relative.startswith("fixture/") or not 0 < member.size <= 128 * 1024:
                    continue
                name = relative.removeprefix("fixture/")
                if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or "." not in name:
                    continue
                if not name.startswith("fixture.") or any(token in name.lower() for token in ("invalid", "corrupt", "truncated", "malformed", "wrong")):
                    continue
                label = name.rsplit(".", 1)[1].lower()
                if not re.fullmatch(r"[a-z0-9]{1,12}", label):
                    continue
                data = archive.extractfile(member).read()
                target = folder / name
                target.write_bytes(data)
                rows.append({"path": str(target.relative_to(ROOT)), "label": label,
                    "source": f"https://github.com/sindresorhus/file-type/blob/{COMMIT}/{relative}",
                    "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
    (BASE / "upstream.json").write_text(json.dumps({"repository": "sindresorhus/file-type", "commit": COMMIT,
        "selection": "fixture.* regular files <=128 KiB; exclude explicitly malformed filenames; no detector source copied",
        "files": sorted(rows, key=lambda row: row["path"])}, indent=2) + "\n")
    print(f"Downloaded {len(rows)} pinned upstream samples, {sum(row['bytes'] for row in rows)} bytes")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch-upstream", action="store_true")
    args = parser.parse_args()
    BASE.mkdir(parents=True, exist_ok=True)
    if args.fetch_upstream:
        fetch()
    old = json.loads((ROOT / "benchmarks/format-detection/report.json").read_text())
    rows = {}

    def add(file, label, origin, expected_hash=None, source=None):
        data = file.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        if expected_hash and expected_hash != sha:
            raise ValueError(f"Fixture changed: {file.relative_to(ROOT)}")
        relative = str(file.relative_to(ROOT))
        rows[relative] = {"path": relative, "label": label, "origin": origin, "sha256": sha, "bytes": len(data),
            **({"source": source} if source else {})}

    for row in old["variants"]["containers"]["rows"]:
        add(ROOT / row["path"], row["label"], "original-513", row["sha256"])
    roots = ["packages/archive/test/fixtures", "packages/model3d/test/fixtures", "packages/converter-client/test/fixtures",
             "converter/testdata", "packages/ebook/test/fixtures"]
    excluded = {"md", "mjs", "ts", "json", "rgba", "lgpl", "mpl", "txt"}
    for directory in roots:
        for file in sorted((ROOT / directory).rglob("*")):
            if not file.is_file() or file.suffix.lower().lstrip(".") in excluded or not file.suffix:
                continue
            if any(word in file.name.upper() for word in ("LICENSE", "NOTICE", "SOURCE")):
                continue
            add(file, file.suffix.lower().lstrip("."), "additional-repository")
    upstream = json.loads((BASE / "upstream.json").read_text()) if (BASE / "upstream.json").exists() else {"files": []}
    for row in upstream["files"]:
        add(ROOT / row["path"], row["label"], "external-file-type", row["sha256"], row["source"])
    manifest = {"schemaVersion": 1, "labeling": "Original conversion manifest/fixture suffix; additional repository fixture suffix; external upstream fixture suffix. Not an independent content audit.",
        "upstreamCommit": upstream.get("commit"), "files": sorted(rows.values(), key=lambda row: row["path"])}
    (BASE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Corpus: {len(rows)} files, {len({row['sha256'] for row in rows.values()})} unique contents, {len({row['label'] for row in rows.values()})} extensions")


if __name__ == "__main__":
    main()
