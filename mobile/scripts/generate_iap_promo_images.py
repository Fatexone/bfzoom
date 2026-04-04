from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


SIZE = 1024
OUTPUT_DIR = Path(__file__).resolve().parents[1] / "app-store" / "ios" / "iap-promotional"

PACKS = [
    {"minutes": 60, "file_name": "bfzoom_iap_promo_60min.png"},
    {"minutes": 180, "file_name": "bfzoom_iap_promo_180min.png"},
    {"minutes": 600, "file_name": "bfzoom_iap_promo_600min.png"},
]

BG_TOP = "#031525"
BG_BOTTOM = "#0B2E4A"
CYAN = "#56D4FF"
CYAN_SOFT = "#B7F1FF"
WHITE = "#F8FCFF"
NAVY = "#082033"


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
        Path("/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/Supplemental/Helvetica.ttc"),
    ]
    for candidate in candidates:
        if candidate.exists():
            try:
                return ImageFont.truetype(str(candidate), size=size)
            except OSError:
                continue
    return ImageFont.load_default()


FONT_BRAND = load_font("brand", 54)
FONT_MINUTES = load_font("minutes", 250)
FONT_SUBTITLE = load_font("subtitle", 62)
FONT_CHIP = load_font("chip", 42)


def vertical_gradient(size: int, top_hex: str, bottom_hex: str) -> Image.Image:
    top = tuple(int(top_hex[i : i + 2], 16) for i in (1, 3, 5))
    bottom = tuple(int(bottom_hex[i : i + 2], 16) for i in (1, 3, 5))
    image = Image.new("RGB", (size, size), top_hex)
    pixels = image.load()
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(
            int(top[index] + (bottom[index] - top[index]) * ratio) for index in range(3)
        )
        for x in range(size):
            pixels[x, y] = color
    return image


def add_glow(base: Image.Image, bbox: tuple[int, int, int, int], color: str, blur: int) -> None:
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.rounded_rectangle(bbox, radius=48, fill=color)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=blur))
    base.alpha_composite(glow)


def centered_text_bbox(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> tuple[int, int, int, int]:
    return draw.textbbox((0, 0), text, font=font)


def draw_centered_text(
    draw: ImageDraw.ImageDraw,
    y: int,
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: str,
) -> tuple[int, int, int, int]:
    bbox = centered_text_bbox(draw, text, font)
    width = bbox[2] - bbox[0]
    x = (SIZE - width) // 2
    draw.text((x, y), text, font=font, fill=fill)
    return draw.textbbox((x, y), text, font=font)


def create_image(minutes: int, output_path: Path) -> None:
    base = vertical_gradient(SIZE, BG_TOP, BG_BOTTOM).convert("RGBA")

    halo = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    halo_draw = ImageDraw.Draw(halo)
    halo_draw.ellipse((120, 110, 900, 820), fill=(86, 212, 255, 36))
    halo_draw.ellipse((280, 200, 760, 680), fill=(255, 255, 255, 24))
    halo = halo.filter(ImageFilter.GaussianBlur(radius=46))
    base.alpha_composite(halo)

    add_glow(base, (132, 724, 892, 862), "#56D4FF20", blur=34)

    draw = ImageDraw.Draw(base)

    draw.rounded_rectangle((82, 78, 302, 144), radius=30, fill="#0E3858")
    draw.text((118, 95), "BFZoom", font=FONT_BRAND, fill=WHITE)

    draw.rounded_rectangle((334, 78, 940, 144), radius=30, fill="#123D60")
    draw.text((380, 94), "LIVE TRANSLATION", font=FONT_CHIP, fill=CYAN_SOFT)

    draw.rounded_rectangle((92, 214, 932, 668), radius=56, fill="#071C2D")
    draw.rounded_rectangle((92, 214, 932, 668), radius=56, outline="#4FD7FF", width=4)

    draw_centered_text(draw, 282, f"{minutes}", FONT_MINUTES, WHITE)
    draw_centered_text(draw, 548, "MINUTES", FONT_SUBTITLE, CYAN_SOFT)

    draw.rounded_rectangle((156, 744, 868, 842), radius=34, fill=NAVY)
    draw.text((238, 772), "FOR BFZOOM CALLS", font=FONT_SUBTITLE, fill=WHITE)

    draw.rounded_rectangle((358, 878, 666, 930), radius=24, fill="#0E3858")
    draw.text((410, 892), "iPhone & iPad", font=FONT_CHIP, fill=CYAN)

    base.convert("RGB").save(output_path, format="PNG", optimize=True)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for pack in PACKS:
        create_image(pack["minutes"], OUTPUT_DIR / pack["file_name"])
    readme = OUTPUT_DIR / "README.md"
    readme.write_text(
        "\n".join(
            [
                "# BFZoom IAP Promotional Images",
                "",
                "Generated assets for App Store Connect promoted In-App Purchases:",
                "",
                "- `bfzoom_iap_promo_60min.png`",
                "- `bfzoom_iap_promo_180min.png`",
                "- `bfzoom_iap_promo_600min.png`",
                "",
                "Design goal: square 1024x1024 image with very large readable text and no dense copy.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
