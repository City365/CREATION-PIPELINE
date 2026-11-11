"""Dump a vtable and disassemble its slots."""
import sys, struct

DLL = r'D:\notebook\software\JianyingPro\11.5.0.14471\lyra_cli_client.dll'


def sections(data):
    pe = struct.unpack_from('<I', data, 0x3C)[0]
    nsec = struct.unpack_from('<H', data, pe + 6)[0]
    optsz = struct.unpack_from('<H', data, pe + 20)[0]
    opt = pe + 24
    magic = struct.unpack_from('<H', data, opt)[0]
    image_base = struct.unpack_from('<Q', data, opt + 24)[0]
    sec = opt + optsz
    out = []
    for i in range(nsec):
        o = sec + i * 40
        name = data[o:o + 8].rstrip(b'\x00').decode('ascii', 'replace')
        vsize, vaddr, rsize, raddr = struct.unpack_from('<IIII', data, o + 8)
        out.append((name, vaddr, vsize, raddr, rsize))
    return image_base, out


def rva2off(secs, rva):
    for name, vaddr, vsize, raddr, rsize in secs:
        if vaddr <= rva < vaddr + max(vsize, rsize):
            return raddr + (rva - vaddr)
    return None


def main():
    data = open(DLL, 'rb').read()
    image_base, secs = sections(data)
    print('image_base=0x%X' % image_base)
    for s in secs:
        print('  %-10s rva=0x%08X vsz=%d' % (s[0], s[1], s[2]))

    vt_rva = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0x70E6B0
    off = rva2off(secs, vt_rva)
    print('\nvtable rva=0x%X off=0x%X' % (vt_rva, off or 0))
    try:
        from capstone import Cs, CS_ARCH_X86, CS_MODE_64
        md = Cs(CS_ARCH_X86, CS_MODE_64)
    except Exception as e:
        print('capstone missing:', e)
        md = None

    for i in range(40):
        p = struct.unpack_from('<Q', data, off + i * 8)[0]
        frva = p - image_base
        fo = rva2off(secs, frva)
        if fo is None:
            print('[%02d] ptr=0x%X -> rva=0x%X OUT OF RANGE' % (i, p, frva))
            break
        code = data[fo:fo + 48]
        ins = []
        if md:
            for n, insn in enumerate(md.disasm(code, image_base + frva)):
                ins.append('%s %s' % (insn.mnemonic, insn.op_str))
                if n >= 5:
                    break
        print('[%02d] rva=0x%08X  %s' % (i, frva, ' | '.join(ins)))


main()
