import re, sys

path = sys.argv[1]
start = int(sys.argv[2], 16)
end = int(sys.argv[3], 16)
data = open(path, 'rb').read()[start:end]
for m in re.finditer(rb'[\x20-\x7e\t]{4,}', data):
    s = m.group().decode('ascii', 'replace')
    print('0x%08X  %s' % (start + m.start(), s))
