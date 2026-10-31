"""Windows native folder chooser; stdout is a single UTF-8 JSON receipt."""
import json
import sys
import tkinter as tk
from tkinter import filedialog

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
try:
    folder = filedialog.askdirectory(parent=root, title='选择项目工作区文件夹', mustexist=True)
    print(json.dumps({'path': folder or '', 'cancelled': not bool(folder)}, ensure_ascii=True))
finally:
    root.destroy()
