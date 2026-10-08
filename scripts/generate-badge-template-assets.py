"""Regenerate the bounded public badge brand snapshot from canonical repository assets."""
from pathlib import Path
import base64
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "mark": ("static/img/logo-color-black.svg", "image/svg+xml"),
    "roboto_latin": ("static/fonts/Roboto-latin.woff2", "font/woff2"),
    "roboto_latin_ext": ("static/fonts/Roboto-latin-ext.woff2", "font/woff2"),
}


def normalize_mark(source: str) -> str:
    """The authored mark has four fixed fills; move only those classes to SVG attributes."""
    style = re.search(r"<style>(.*?)</style>", source, re.S)
    if not style:
        raise ValueError("Canonical mark style changed; review the vector snapshot generator")
    fills = dict(re.findall(r"\.([a-d])\{fill:(#[0-9a-fA-F]{3,6})\}", style[1]))
    if len(fills) != 4 or "".join("." + key + "{fill:" + value + "}" for key, value in fills.items()) != style[1]:
        raise ValueError("Canonical mark has new styling; review before regenerating")
    source = source.replace(style[0], "")
    source = re.sub(r'class="([a-d])"', lambda match: 'fill="' + fills[match[1]] + '"', source)
    if re.search(r"<style|\bclass=|\bstyle=|\bon[a-z]+=", source):
        raise ValueError("Canonical mark has unexpected active or unscoped styling")
    return source


def generate() -> str:
    assets = {}
    provenance = {}
    for key, (relative, mime) in SOURCES.items():
        raw = (ROOT / relative).read_bytes()
        provenance[key] = {"path": relative, "sha256": hashlib.sha256(raw).hexdigest()}
        normalized = normalize_mark(raw.decode()).encode() if key == "mark" else raw
        assets[key] = {"mime": mime, "base64": base64.b64encode(normalized).decode()}
    license_text = (ROOT / "static/fonts/Roboto-OFL.txt").read_text()
    font_css = re.sub(r"/\*[\s\S]*?\*/", "", (ROOT / "assets/design/fonts.css").read_text()).strip()
    font_css = font_css.replace("/fonts/Roboto-latin.woff2", "asset:roboto_latin").replace("/fonts/Roboto-latin-ext.woff2", "asset:roboto_latin_ext")
    return "\n".join([
        "/** Generated from canonical public assets by scripts/generate-badge-template-assets.py. */",
        'import type { EventBadgeTemplate } from "./schemas/event-badge-template";',
        "export const BADGE_GENERIC_BRAND_ASSETS = " + json.dumps(assets, indent=2) + " as const satisfies EventBadgeTemplate[\"assets\"];",
        "export const BADGE_GENERIC_BRAND_PROVENANCE = " + json.dumps(provenance, indent=2) + " as const;",
        "export const BADGE_GENERIC_FONT_CSS = " + json.dumps(font_css) + ";",
        "/** Roboto 3.015 (2026); embedded font metadata names the Roboto Project Authors and OFL URL. */",
        "export const BADGE_GENERIC_FONT_LICENSE = " + json.dumps(license_text) + ";",
        "",
    ])


if __name__ == "__main__":
    destination = ROOT / "assets/shared/badge-generic-template-assets.ts"
    destination.write_text(generate())
    print("Regenerated", destination.relative_to(ROOT))
