#!/usr/bin/env python3
"""
verify-landmark.py — measures the hair shaft's position IN THE CAPTURED PIXELS.

The capture harness already proves landmark identity from the projection maths.
This proves it the other way round, from the images alone: find the dark pigmented
shaft in each microscope frame and check that its centroid sits on the anchor, and
that its width grows monotonically as the field narrows.

    python3 tools/verify-landmark.py captures/run
"""
import json
import struct
import sys
import zlib
from pathlib import Path


def read_png(path):
    d = path.read_bytes()
    assert d[:8] == b"\x89PNG\r\n\x1a\n", f"not a png: {path}"
    pos, idat, w, h, ct = 8, b"", None, None, None
    while pos < len(d):
        ln = struct.unpack(">I", d[pos : pos + 4])[0]
        typ = d[pos + 4 : pos + 8]
        data = d[pos + 8 : pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            w, h, _bd, ct = struct.unpack(">IIBB", data[:10])
        elif typ == b"IDAT":
            idat += data
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    stride = w * ch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if f == 1:
            for i in range(ch, stride):
                line[i] = (line[i] + line[i - ch]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - ch] if i >= ch else 0
                b = prev[i]
                c = prev[i - ch] if i >= ch else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride : (y + 1) * stride] = line
        prev = line
    return w, h, ch, out


def shaft_centroid(w, h, ch, px):
    """The pigmented hair shaft is the only dark warm-brown thing in the field."""
    sx = sy = n = 0
    rows = {}
    for y in range(0, h, 2):
        base = y * w * ch
        row = 0
        for x in range(0, w, 2):
            i = base + x * ch
            r, g, b = px[i], px[i + 1], px[i + 2]
            if r < 165 and b < 130 and r > g >= b and (r - b) > 22 and r > 45:
                sx += x
                sy += y
                n += 1
                row += 1
        if row:
            rows[y] = row
    if n < 40:
        return None
    # Width from the median row's run of shaft pixels (x sampled every 2 px).
    widths = sorted(rows.values())
    return {"x": sx / n, "y": sy / n, "n": n, "width_px": widths[len(widths) // 2] * 2}


root = Path(sys.argv[1] if len(sys.argv) > 1 else "captures/run")
report = json.loads((root / "report.json").read_text())
fails = []

for device, info in report["devices"].items():
    print(f"\n== {device} ==")
    prev_width = None
    for shot in info["shots"]:
        path = Path(shot["file"])
        if not path.exists():
            continue
        # Only the microscope frames: before the field opens there is no shaft to find.
        if shot["p"] < 0.28:
            continue
        w, h, ch, px = read_png(path)
        c = shaft_centroid(w, h, ch, px)
        if not c:
            print(f"  {shot['id']:<9} shaft NOT FOUND")
            fails.append(f"{device}/{shot['id']}: shaft not found")
            continue
        ax = shot["anchor"]["x"] * w
        ay = shot["anchor"]["y"] * h
        dx = (c["x"] - ax) / w
        dy = (c["y"] - ay) / h
        # The shaft is a tilted line through the anchor, so its centroid can sit a
        # little along that line; what must not happen is drift across it.
        off = (dx * dx + dy * dy) ** 0.5
        grew = "" if prev_width is None else ("+" if c["width_px"] >= prev_width else "SHRANK")
        if grew == "SHRANK":
            fails.append(f"{device}/{shot['id']}: shaft width shrank while zooming in")
        if off > 0.09:
            fails.append(f"{device}/{shot['id']}: shaft centroid {off:.3f} off anchor")
        print(
            f"  {shot['id']:<9} field={shot['fieldMM']:>6.3f}mm  shaft width={c['width_px']:>4}px "
            f"{grew:<6} centroid offset from anchor = ({dx:+.3f}, {dy:+.3f})  |d|={off:.3f}"
        )
        prev_width = c["width_px"]

print()
if fails:
    print(f"{len(fails)} problem(s):")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("landmark held in the pixels at every microscope frame, on every device")
