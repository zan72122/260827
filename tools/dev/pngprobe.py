"""Minimal PNG reader + a scan for the debug grid lines, so the on-screen scale can
be measured rather than eyeballed."""
import sys, zlib, struct

def read_png(path):
    d = open(path, 'rb').read()
    assert d[:8] == b'\x89PNG\r\n\x1a\n'
    pos = 8; idat = b''; w = h = bd = ct = None
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]
        typ = d[pos+4:pos+8]; data = d[pos+8:pos+8+ln]; pos += 12 + ln
        if typ == b'IHDR':
            w, h, bd, ct = struct.unpack('>IIBB', data[:10])
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
    raw = zlib.decompress(idat)
    ch = {0:1, 2:3, 3:1, 4:2, 6:4}[ct]
    stride = w * ch
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p+stride]); p += stride
        if f == 1:
            for i in range(ch, stride): line[i] = (line[i] + line[i-ch]) & 255
        elif f == 2:
            for i in range(stride): line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i-ch] if i >= ch else 0
                b = prev[i]; c = prev[i-ch] if i >= ch else 0
                pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2*c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y*stride:(y+1)*stride] = line
        prev = line
    return w, h, ch, out

w, h, ch, px = read_png(sys.argv[1])
row = int(sys.argv[2]) if len(sys.argv) > 2 else h // 2
print(f'{w}x{h} ch={ch} scanning row {row}')

def at(x, y):
    i = (y*w + x)*ch
    return px[i], px[i+1], px[i+2]

# green major grid lines: g clearly dominant
greens = []
for x in range(w):
    r, g, b = at(x, row)
    if g > 110 and g > r + 45 and g > b + 45:
        greens.append(x)
groups = []
for x in greens:
    if groups and x - groups[-1][-1] <= 3: groups[-1].append(x)
    else: groups.append([x])
centres = [sum(gr)/len(gr) for gr in groups]
print('green line centres:', [round(c,1) for c in centres])
if len(centres) > 1:
    d = [round(centres[i+1]-centres[i],1) for i in range(len(centres)-1)]
    print('spacings:', d, ' mean', round(sum(d)/len(d),1))

# circle extent: non-background pixels on this row
bg = at(2, row)
xs = [x for x in range(w) if abs(at(x,row)[0]-bg[0]) + abs(at(x,row)[1]-bg[1]) + abs(at(x,row)[2]-bg[2]) > 40]
if xs:
    print('content span x:', xs[0], '->', xs[-1], ' width', xs[-1]-xs[0])

# Locate the epidermis: rows richest in hematoxylin-blue pixels.
scores = []
for y in range(0, h, 4):
    n = 0
    for x in range(0, w, 3):
        r, g, b = at(x, y)
        if b > r + 12 and b > 60 and r < 210:
            n += 1
    scores.append((n, y))
scores.sort(reverse=True)
print('bluest rows:', [(n, y) for n, y in scores[:8]])
