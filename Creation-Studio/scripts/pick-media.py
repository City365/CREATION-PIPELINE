"""Windows native file chooser for the editor; stdout is one UTF-8 JSON receipt.

argv: [--single] [--title TEXT] [--ext .srt .vtt ...]
"""
import json
import os
import sys
import tkinter as tk
from tkinter import filedialog

VIDEO = ('*.mp4', '*.mov', '*.m4v', '*.mkv', '*.webm', '*.avi', '*.flv', '*.wmv', '*.ts', '*.mpg', '*.mpeg')
AUDIO = ('*.mp3', '*.wav', '*.m4a', '*.aac', '*.flac', '*.ogg', '*.opus', '*.wma', '*.aif', '*.aiff')
IMAGE = ('*.png', '*.jpg', '*.jpeg', '*.webp', '*.bmp', '*.gif', '*.heic', '*.tif', '*.tiff')

args = sys.argv[1:]
single = '--single' in args
title = '选择要导入时间线的素材（可多选）'
custom = []
index = 0
while index < len(args):
    item = args[index]
    if item == '--title' and index + 1 < len(args):
        title = args[index + 1]
        index += 2
        continue
    if item == '--ext':
        index += 1
        while index < len(args) and args[index].startswith('.'):
            custom.append('*' + args[index])
            index += 1
        continue
    index += 1

if custom:
    filetypes = [('可选文件', tuple(custom)), ('全部文件', ('*.*',))]
else:
    filetypes = [
        ('全部支持的素材', tuple(list(VIDEO) + list(AUDIO) + list(IMAGE))),
        ('视频', VIDEO),
        ('音频', AUDIO),
        ('图片', IMAGE),
        ('全部文件', ('*.*',)),
    ]

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
try:
    if single:
        one = filedialog.askopenfilename(parent=root, title=title, filetypes=filetypes)
        picked = (one,) if one else ()
    else:
        picked = filedialog.askopenfilenames(parent=root, title=title, filetypes=filetypes)
    files = []
    for raw in (picked or ()):
        path = os.path.abspath(str(raw))
        if os.path.isfile(path):
            files.append(path)
    print(json.dumps({'files': files, 'cancelled': not bool(files)}, ensure_ascii=True))
except Exception as error:  # noqa: BLE001 - the receipt is the contract
    print(json.dumps({'files': [], 'cancelled': True, 'error': str(error)}, ensure_ascii=True))
finally:
    try:
        root.destroy()
    except Exception:  # noqa: BLE001
        sys.exit(0)
