#!/usr/bin/env python3
from __future__ import annotations

import argparse
import math
from pathlib import Path
from typing import Iterable, List, Sequence, Tuple

from PIL import Image, ImageEnhance, ImageFilter, ImageOps


DEFAULT_TARGETS: Sequence[Tuple[int, int]] = (
    (1284, 2778),
    (2778, 1284),
    (1242, 2688),
    (2688, 1242),
)

SUPPORTED_EXT = {".png", ".jpg", ".jpeg", ".webp"}


def parse_targets(raw: str) -> List[Tuple[int, int]]:
    items: List[Tuple[int, int]] = []
    for chunk in raw.split(","):
        part = chunk.strip().lower()
        if not part:
            continue
        if "x" not in part:
            raise ValueError(f"Invalid target format: {part}")
        w_raw, h_raw = part.split("x", 1)
        w, h = int(w_raw), int(h_raw)
        if w <= 0 or h <= 0:
            raise ValueError(f"Invalid target size: {part}")
        items.append((w, h))
    if not items:
        raise ValueError("No valid target size provided.")
    return items


def list_images(input_dir: Path) -> List[Path]:
    files = [p for p in input_dir.iterdir() if p.is_file() and p.suffix.lower() in SUPPORTED_EXT]
    return sorted(files, key=lambda p: p.name.lower())


def build_canvas(source: Image.Image, target_w: int, target_h: int) -> Image.Image:
    source = source.convert("RGB")
    source_w, source_h = source.size
    target_ratio = target_w / target_h
    source_ratio = source_w / source_h

    if source_ratio > target_ratio:
        bg_h = target_h
        bg_w = math.ceil(bg_h * source_ratio)
    else:
        bg_w = target_w
        bg_h = math.ceil(bg_w / source_ratio)

    bg = source.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
    bg = ImageOps.fit(bg, (target_w, target_h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    bg = bg.filter(ImageFilter.GaussianBlur(radius=26))
    bg = ImageEnhance.Brightness(bg).enhance(0.68)

    margin = int(min(target_w, target_h) * 0.03)
    fg = ImageOps.contain(
        source,
        (target_w - margin * 2, target_h - margin * 2),
        method=Image.Resampling.LANCZOS,
    )
    x = (target_w - fg.width) // 2
    y = (target_h - fg.height) // 2
    bg.paste(fg, (x, y))
    return bg


def generate(input_dir: Path, output_dir: Path, targets: Iterable[Tuple[int, int]]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    images = list_images(input_dir)
    if not images:
        raise FileNotFoundError(f"No source image found in: {input_dir}")

    written = 0
    for idx, src_path in enumerate(images, start=1):
        with Image.open(src_path) as src:
            for target_w, target_h in targets:
                out_img = build_canvas(src, target_w, target_h)
                out_name = f"{idx:02d}_{src_path.stem}_{target_w}x{target_h}.png"
                out_path = output_dir / out_name
                out_img.save(out_path, format="PNG", optimize=True)
                written += 1

    print(f"Done. Generated {written} file(s) in {output_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate App Store iOS screenshot sizes from raw captures."
    )
    parser.add_argument(
        "--input-dir",
        default="app-store/ios/raw",
        help="Folder containing raw screenshots.",
    )
    parser.add_argument(
        "--output-dir",
        default="app-store/ios/screenshots",
        help="Folder where generated screenshots will be written.",
    )
    parser.add_argument(
        "--targets",
        default=",".join(f"{w}x{h}" for w, h in DEFAULT_TARGETS),
        help="Comma-separated sizes, ex: 1284x2778,1242x2688",
    )
    args = parser.parse_args()

    input_dir = Path(args.input_dir).resolve()
    output_dir = Path(args.output_dir).resolve()
    targets = parse_targets(args.targets)
    generate(input_dir, output_dir, targets)


if __name__ == "__main__":
    main()
