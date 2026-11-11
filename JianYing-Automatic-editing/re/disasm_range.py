"""Disassemble a byte range of a PE file given RVAs."""
import struct, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

path = sys.argv[1]
start = int(sys.argv[2], 16)
end = int(sys.argv[3], 16)

d = open(path, 'rb').read()
pe = struct.unpack_from('<I', d, 0x3C)[0]
nsec = struct.unpack_from('<H', d, pe + 6)[0]
optsz = struct.unpack_from('<H', d, pe + 20)[0]
opt = pe + 24
image_base = struct.unpack_from('<Q', d, opt + 24)[0]
so = opt + optsz
secs = []
for i in range(nsec):
    o = so + i * 40
    nm = d[o:o + 8].rstrip(b'\0').decode('ascii', 'replace')
    vs, va, rs, ra = struct.unpack_from('<IIII', d, o + 8)
    secs.append((nm, va, vs, ra, rs))


def rva2off(r):
    for nm, va, vs, ra, rs in secs:
        if va <= r < va + max(vs, rs):
            return ra + (r - va)
    return None


off = rva2off(start)
end_off = rva2off(end)
if off is None or end_off is None:
    print('range not mapped')
    sys.exit(1)

code = d[off:end_off]
md = Cs(CS_ARCH_X86, CS_MODE_64)
md.detail = False
for insn in md.disasm(code, image_base + start):
    txt = '%s %s' % (insn.mnemonic, insn.op_str)
    mark = ''
    if 'rip' in insn.op_str:
        try:
            disp = int(insn.op_str.split('rip + ')[1].rstrip(']'), 16)
            dst = insn.address + insn.size + disp - image_base
            if 0 < dst < len(d):
                o2 = rva2off(dst)
                if o2 is not None:
                    s = d[o2:o2 + 60].split(b'\0')[0]
                    if all(32 <= c < 127 or c in (9, 10, 13) for c in s) and len(s) >= 4:
                        mark = '   ; "%s"' % s.decode('ascii', 'replace')
                    else:
                        mark = '   ; rva 0x%X' % dst
        except (IndexError, ValueError):
            pass
    print('0x%08X  %-46s%s' % (insn.address - image_base, txt, mark))
