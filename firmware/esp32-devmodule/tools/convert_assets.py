#!/usr/bin/env python3
"""
Convert every PNG in sdcard-src/ into an LVGL v9 binary image under
sdcard/mindbuddy/.

  python3 tools/convert_assets.py            # convert everything
  python3 tools/convert_assets.py icons/nav  # convert one subfolder

Requires:
  pip install pillow

The output is LVGL's raw image binary format:
  header (12 bytes) + pixel data
  - RGB565 (cf=15) for opaque images
  - RGB565A8 (cf=20) for images with an alpha channel

That format is what `lv_image_set_src(obj, "S:backgrounds/home.bin")`
reads on the ESP32 side (see src/ui/assets.cpp).
"""

from __future__ import annotations
import struct
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.stderr.write("pip install pillow\n")
    sys.exit(1)

ROOT       = Path(__file__).resolve().parent.parent
SRC_ROOT   = ROOT / "sdcard-src"
DST_ROOT   = ROOT / "sdcard" / "mindbuddy"

# LVGL v9 color-format IDs
CF_RGB565    = 15
CF_RGB565A8  = 20

def rgb565(r: int, g: int, b: int) -> int:
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)

def encode_image(img: Image.Image) -> tuple[int, bytes]:
    w, h = img.size
    if img.mode == "RGBA":
        cf = CF_RGB565A8
        color = bytearray(w * h * 2)
        alpha = bytearray(w * h)
        px = img.load()
        i2 = 0
        i1 = 0
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                v = rgb565(r, g, b)
                color[i2]     = v & 0xFF
                color[i2 + 1] = (v >> 8) & 0xFF
                alpha[i1]     = a
                i2 += 2
                i1 += 1
        return cf, bytes(color) + bytes(alpha)
    img = img.convert("RGB")
    cf = CF_RGB565
    data = bytearray(w * h * 2)
    px = img.load()
    i = 0
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            v = rgb565(r, g, b)
            data[i]     = v & 0xFF
            data[i + 1] = (v >> 8) & 0xFF
            i += 2
    return cf, bytes(data)

def lvgl_header(cf: int, w: int, h: int, stride: int, data_len: int) -> bytes:
    # LVGL v9 lv_image_header_t (packed to 12 bytes):
    #   uint32_t magic=0x19  (LV_IMAGE_HEADER_MAGIC lower byte)
    #   uint8_t  cf
    #   uint8_t  flags
    #   uint16_t w
    #   uint16_t h
    #   uint16_t stride
    #   uint16_t reserved_2
    # Followed by the raw pixel payload. This matches LVGL's built-in
    # binary decoder (see lv_bin_decoder.c).
    magic = 0x19
    flags = 0
    return struct.pack("<IBBHHHH", magic, cf, flags, w, h, stride, 0) + \
           struct.pack("<I", data_len)  # payload length trailer (used by
                                        # LVGL's file-based decoder to
                                        # know how much to read).

def convert_one(src: Path) -> Path:
    rel = src.relative_to(SRC_ROOT).with_suffix(".bin")
    dst = DST_ROOT / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    img = Image.open(src)
    cf, payload = encode_image(img)
    stride = img.size[0] * (2 if cf == CF_RGB565 else 3)
    header = lvgl_header(cf, img.size[0], img.size[1], stride, len(payload))
    dst.write_bytes(header + payload)
    print(f"  {rel}  ({img.size[0]}x{img.size[1]}, cf={cf})")
    return dst

def main() -> int:
    if not SRC_ROOT.exists():
        sys.stderr.write(f"missing {SRC_ROOT}\n")
        return 1
    filt = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    scan = SRC_ROOT / filt if filt else SRC_ROOT
    if not scan.exists():
        sys.stderr.write(f"no such folder: {scan}\n")
        return 1
    pngs = sorted(scan.rglob("*.png"))
    if not pngs:
        print("no PNGs found — drop source art into", scan)
        return 0
    print(f"converting {len(pngs)} file(s)…")
    for p in pngs:
        convert_one(p)
    print("done →", DST_ROOT)
    return 0

if __name__ == "__main__":
    sys.exit(main())
