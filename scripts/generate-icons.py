#!/usr/bin/env python3
"""
Generates the app, tray and badge icons.

Written by hand instead of pulled from a dependency because nativeImage only decodes PNG and
JPEG - an SVG yields a silently empty image - and the badge digits have to be pre-rendered
anyway: drawing a number at runtime would mean a second renderer process just to paint it.

Run: python3 scripts/generate-icons.py
"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# WhatsApp-adjacent palette, but distinct enough not to impersonate it.
TEAL = (0x11, 0x8C, 0x7E, 255)
TEAL_DARK = (0x0B, 0x5F, 0x55, 255)
WHITE = (255, 255, 255, 255)
BADGE_RED = (0xE5, 0x3E, 0x3E, 255)
CLEAR = (0, 0, 0, 0)


def new_canvas(size, colour=CLEAR):
    return [[colour for _ in range(size)] for _ in range(size)]


def write_png(path, pixels):
    height = len(pixels)
    width = len(pixels[0])
    raw = bytearray()
    for row in pixels:
        raw.append(0)  # filter type 0
        for r, g, b, a in row:
            raw += bytes((r, g, b, a))

    def chunk(tag, data):
        payload = tag + data
        return struct.pack(">I", len(data)) + payload + struct.pack(">I", zlib.crc32(payload))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    return png


def blend(dst, src):
    """Straight alpha-over, so anti-aliased edges do not show a dark halo."""
    sa = src[3] / 255
    if sa >= 1:
        return src
    if sa <= 0:
        return dst
    da = dst[3] / 255
    out_a = sa + da * (1 - sa)
    if out_a == 0:
        return CLEAR
    return tuple(
        [int(round((src[i] * sa + dst[i] * da * (1 - sa)) / out_a)) for i in range(3)]
        + [int(round(out_a * 255))]
    )


def fill_circle(pixels, cx, cy, radius, colour, samples=4):
    """Supersampled so 16px icons do not look like Lego."""
    size = len(pixels)
    step = 1.0 / samples
    for y in range(size):
        for x in range(size):
            hits = 0
            for sy in range(samples):
                for sx in range(samples):
                    px = x + (sx + 0.5) * step
                    py = y + (sy + 0.5) * step
                    if (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius:
                        hits += 1
            if hits:
                alpha = int(round(colour[3] * hits / (samples * samples)))
                pixels[y][x] = blend(pixels[y][x], (colour[0], colour[1], colour[2], alpha))


def fill_rounded_rect(pixels, x0, y0, x1, y1, radius, colour, samples=4):
    size = len(pixels)
    step = 1.0 / samples

    def inside(px, py):
        if px < x0 or px > x1 or py < y0 or py > y1:
            return False
        for cx, cy in ((x0 + radius, y0 + radius), (x1 - radius, y0 + radius),
                       (x0 + radius, y1 - radius), (x1 - radius, y1 - radius)):
            if ((px < x0 + radius and cx == x0 + radius) or (px > x1 - radius and cx == x1 - radius)) and \
               ((py < y0 + radius and cy == y0 + radius) or (py > y1 - radius and cy == y1 - radius)):
                return (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius
        return True

    for y in range(size):
        for x in range(size):
            hits = 0
            for sy in range(samples):
                for sx in range(samples):
                    if inside(x + (sx + 0.5) * step, y + (sy + 0.5) * step):
                        hits += 1
            if hits:
                alpha = int(round(colour[3] * hits / (samples * samples)))
                pixels[y][x] = blend(pixels[y][x], (colour[0], colour[1], colour[2], alpha))


def fill_triangle(pixels, points, colour, samples=4):
    size = len(pixels)
    step = 1.0 / samples
    (ax, ay), (bx, by), (cx, cy) = points

    def sign(px, py, x1, y1, x2, y2):
        return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2)

    def inside(px, py):
        d1 = sign(px, py, ax, ay, bx, by)
        d2 = sign(px, py, bx, by, cx, cy)
        d3 = sign(px, py, cx, cy, ax, ay)
        has_neg = d1 < 0 or d2 < 0 or d3 < 0
        has_pos = d1 > 0 or d2 > 0 or d3 > 0
        return not (has_neg and has_pos)

    for y in range(size):
        for x in range(size):
            hits = 0
            for sy in range(samples):
                for sx in range(samples):
                    if inside(x + (sx + 0.5) * step, y + (sy + 0.5) * step):
                        hits += 1
            if hits:
                alpha = int(round(colour[3] * hits / (samples * samples)))
                pixels[y][x] = blend(pixels[y][x], (colour[0], colour[1], colour[2], alpha))


# 3x5 bitmap digits, scaled at draw time. A real font would be another dependency for ten glyphs.
DIGITS = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    "+": ["000", "010", "111", "010", "000"],
}


def draw_text(pixels, text, x, y, scale, colour, spacing=1):
    cursor = x
    for char in text:
        glyph = DIGITS.get(char)
        if glyph is None:
            cursor += (3 + spacing) * scale
            continue
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit != "1":
                    continue
                for dy in range(scale):
                    for dx in range(scale):
                        px, py = cursor + gx * scale + dx, y + gy * scale + dy
                        if 0 <= px < len(pixels) and 0 <= py < len(pixels):
                            pixels[py][px] = blend(pixels[py][px], colour)
        cursor += (3 + spacing) * scale


def speech_bubble(size, body, accent, margin_ratio=0.08):
    """The app mark: a rounded square with a chat bubble cut out of it."""
    pixels = new_canvas(size)
    m = size * margin_ratio
    fill_rounded_rect(pixels, m, m, size - 1 - m, size - 1 - m, size * 0.22, body)
    # bubble
    bx0, by0 = size * 0.24, size * 0.26
    bx1, by1 = size * 0.76, size * 0.62
    fill_rounded_rect(pixels, bx0, by0, bx1, by1, size * 0.12, accent)
    fill_triangle(
        pixels,
        [(size * 0.30, by1 - size * 0.01), (size * 0.50, by1 - size * 0.01), (size * 0.27, size * 0.80)],
        accent,
    )
    return pixels


def make_ico(png_bytes_by_size):
    """Vista-style ICO: each entry is a whole PNG. Windows has accepted this since 2007."""
    entries = sorted(png_bytes_by_size.items())
    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    directory = b""
    payload = b""
    for size, data in entries:
        dim = 0 if size >= 256 else size
        directory += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    return header + directory + payload


def main():
    build = ROOT / "build"
    tray = ROOT / "resources" / "tray"
    badges = ROOT / "resources" / "badges"

    # --- application icon -------------------------------------------------
    ico_parts = {}
    for size in (16, 24, 32, 48, 64, 128, 256):
        pixels = speech_bubble(size, TEAL, WHITE)
        data = write_png(build / f"icon-{size}.png", pixels)
        ico_parts[size] = data
    (build / "icon.ico").write_bytes(make_ico(ico_parts))
    # electron-builder wants a 512px icon.png for macOS/Linux
    write_png(build / "icon.png", speech_bubble(512, TEAL, WHITE))

    # --- tray -------------------------------------------------------------
    for size in (16, 32):
        write_png(tray / f"tray-{size}.png", speech_bubble(size, TEAL, WHITE))
    (tray / "tray.ico").write_bytes(
        make_ico({s: write_png(tray / f"_tmp-{s}.png", speech_bubble(s, TEAL, WHITE)) for s in (16, 32)})
    )
    for leftover in tray.glob("_tmp-*.png"):
        leftover.unlink()

    # macOS template images are pure black + alpha; the OS recolours them for light and dark bars.
    for size, suffix in ((16, ""), (32, "@2x")):
        pixels = speech_bubble(size, (0, 0, 0, 255), CLEAR)
        write_png(tray / f"trayTemplate{suffix}.png", pixels)

    # --- unread badges ----------------------------------------------------
    for label in [str(n) for n in range(1, 10)] + ["9plus"]:
        size = 32  # rendered at 2x, Windows scales the 16x16 overlay down cleanly
        pixels = new_canvas(size)
        fill_circle(pixels, size / 2 - 0.5, size / 2 - 0.5, size / 2 - 0.5, BADGE_RED)
        text = "9+" if label == "9plus" else label
        # A single digit gets more room than "9+", so the badge stays legible at 16px.
        scale = 3 if len(text) == 1 else 2
        width = (len(text) * 3 + (len(text) - 1)) * scale
        draw_text(pixels, text, round((size - width) / 2), round((size - 5 * scale) / 2), scale, WHITE)
        write_png(badges / f"{label}.png", pixels)

    print("icons written:")
    for path in sorted(list(build.glob("icon*")) + list(tray.glob("*")) + list(badges.glob("*"))):
        print(f"  {path.relative_to(ROOT)}  {path.stat().st_size} B")


if __name__ == "__main__":
    main()
