#!/usr/bin/env python3
"""Read-only three-way inventory. Never copies, deletes or runs project files."""
import argparse
import hashlib
import json
from pathlib import Path


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def classify(base, incoming, current):
    if current == incoming:
        return "already_equal"
    if base == incoming:
        return "keep_kondo"
    if current == base:
        return "candidate_change"
    return "needs_merge"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("current", type=Path, help="Kondo checkout, containing package.json")
    parser.add_argument("--incoming", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    incoming = args.incoming.resolve()
    current = args.current.resolve()
    if not (current / "package.json").is_file():
        parser.error("Current folder must contain package.json; nothing was changed.")
    base = json.loads((incoming / "docs/fleetmind-v3/BASELINE_KONDO_SHA256.json").read_text())
    manifest = json.loads((incoming / "docs/fleetmind-v3/SOURCE_MANIFEST.json").read_text())
    rows = []
    for name, expected in sorted(manifest.items()):
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid manifest path")
        source = (incoming / relative).resolve()
        target = (current / relative).resolve()
        if not source.is_relative_to(incoming) or not target.is_relative_to(current):
            raise ValueError("Refusing a path outside the checkout")
        actual = digest(source)
        if actual != expected:
            raise ValueError(f"Incoming file hash mismatch: {name}")
        result = classify(base.get(name), actual, digest(target))
        if result != "already_equal":
            rows.append({"path": name, "result": result})
    print(json.dumps({"mode": "read_only", "counts": {key: sum(r["result"] == key for r in rows) for key in ("candidate_change", "keep_kondo", "needs_merge")}, "files": rows}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
