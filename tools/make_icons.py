# icons/16・32・48・128.png を描く使い捨てのスクリプト(標準ライブラリだけ。拡張には入れない)。PostClip の tools/make_icons.py の形違い。
# 画面設計書 §7.6: 勝色(#2B4C7E)の角丸の四角に、白いレンズ(輪と柄)と中の 2 本の線。形は画面モックの 24 単位の SVG のまま。
# 使い方: github-repo-lens フォルダで python tools/make_icons.py
import math
import pathlib
import struct
import zlib

BG = (0x2B, 0x4C, 0x7E)
WHITE = (255, 255, 255)


def inside_rounded(x, y, lo=1.0, hi=23.0, r=6.0):
    if not (lo <= x <= hi and lo <= y <= hi):
        return False
    cx = min(max(x, lo + r), hi - r)
    cy = min(max(y, lo + r), hi - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def near_segment(x, y, ax, ay, bx, by, width):
    # 線の太さ width・端が丸い線分の内側か
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= width / 2


def in_mark(x, y):
    ring = abs(math.hypot(x - 10.5, y - 10.5) - 5.6) <= 1.9 / 2
    return (
        ring
        or near_segment(x, y, 7.9, 9.3, 13.1, 9.3, 1.5)
        or near_segment(x, y, 7.9, 11.9, 11.3, 11.9, 1.5)
        or near_segment(x, y, 14.8, 14.8, 18.6, 18.6, 2.3)
    )


def pixel(px, py, size, ss=4):
    hits_bg = hits_fg = 0
    for i in range(ss):
        for j in range(ss):
            x = (px + (i + 0.5) / ss) / size * 24
            y = (py + (j + 0.5) / ss) / size * 24
            if inside_rounded(x, y):
                hits_bg += 1
                if in_mark(x, y):
                    hits_fg += 1
    if hits_bg == 0:
        return (0, 0, 0, 0)
    t = hits_fg / hits_bg
    rgb = tuple(round(BG[k] * (1 - t) + WHITE[k] * t) for k in range(3))
    return (*rgb, round(255 * hits_bg / (ss * ss)))


def png(size):
    rows = b"".join(b"\x00" + bytes(c for x in range(size) for c in pixel(x, y, size)) for y in range(size))
    chunk = lambda tag, data: struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def main():
    out = pathlib.Path(__file__).resolve().parent.parent / "icons"
    out.mkdir(exist_ok=True)
    for size in (16, 32, 48, 128):
        (out / f"{size}.png").write_bytes(png(size))
        print(out / f"{size}.png")


if __name__ == "__main__":
    main()
