"""Find RIP-relative references to a target RVA in a PE file."""
import struct, sys

path = sys.argv[1]
target = int(sys.argv[2], 16)

d = open(path, 'rb').read()
pe = struct.unpack_from('<I', d, 0x3C)[0]
nsec = struct.unpack_from('<H', d, pe + 6)[0]
optsz = struct.unpack_from('<H', d, pe + 20)[0]
opt = pe + 24
secs = []
so = opt + optsz
for i in range(nsec):
    o = so + i * 40
    nm = d[o:o + 8].rstrip(b'\0').decode('ascii', 'replace')
    vs, va, rs, ra = struct.unpack_from('<IIII', d, o + 8)
    secs.append((nm, va, vs, ra, rs))


def off2rva(off):
    for nm, va, vs, ra, rs in secs:
        if ra <= off < ra + rs:
            return va + (off - ra), nm
    return None, None


# lea forms: REX 48/4C then 8D then modrm with mod=00 rm=101 (rip-relative)
MODRM = (0x05, 0x0D, 0x15, 0x1D, 0x25, 0x2D, 0x35, 0x3D)
hits = 0
n = len(d)
for i in range(n - 7):
    b0 = d[i]
    if b0 not in (0x48, 0x4C):
        continue
    if d[i + 1] != 0x8D:
        continue
    if d[i + 2] not in MODRM:
        continue
    rva, sec = off2rva(i)
    if rva is None:
        continue
    disp = struct.unpack_from('<i', d, i + 3)[0]
    dst = rva + 7 + disp
    if dst == target:
        hits += 1
        print('hit at file=0x%X rva=0x%X sec=%s  bytes=%s' %
              (i, rva, sec, d[i:i + 7].hex()))
print('--- hits: %d (target rva 0x%X) ---' % (hits, target))
