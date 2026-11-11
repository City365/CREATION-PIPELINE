import re, sys, os

def strings(path, minlen=5):
    data = open(path, 'rb').read()
    for m in re.finditer(rb'[\x20-\x7e]{%d,}' % minlen, data):
        yield m.start(), m.group().decode('ascii', 'replace')

path = sys.argv[1]
pats = [p.lower() for p in sys.argv[2:]] or None
n = 0
for off, s in strings(path):
    if pats and not any(p in s.lower() for p in pats):
        continue
    n += 1
    if n <= 400:
        print('0x%08X  %s' % (off, s[:200]))
print('--- total hits: %d ---' % n)
