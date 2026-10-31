#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
分镜提示词文本 -> 标准任务文件（JSON + Excel）

用法：
  python build_tasks.py --input "分镜.txt" --assets "D:/.../assets/素材" --out "output"

输入：以 *::~RECORD::~* 分隔的记录块（*::~OUTPUT_START::~* / *::~OUTPUT_END::~* 可选）。
每条记录原文整段作为提示词；画幅默认 16:9；时长取「时长：N秒」。
参考图只取「角色」+「场景」，「物品」不进参考图。

只依赖 Python 3.9+；有 openpyxl 时输出带样式的表格，没有则退回无样式但同样可解析的 xlsx。
"""

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"]
HEADERS = ["分镜名称", "视频提示词", "参考图（按顺序）", "参考图说明（按顺序）", "视频画幅", "视频时长"]
MAX_IMAGES = 9
MAX_PROMPT = 10000
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}
MARKER_RE = re.compile(r"^\*::~([A-Za-z_]+)::~\*$")
FIELD_RE = re.compile(r"^(场景|角色|时间|时长|物品|音色锁定|人物锚点|场景锚点|剧情承接)\s*[：:]\s*(.*)$")
LIST_SPLIT = re.compile(r"[、,，;；]")

HELP_ROWS = [
    ["列名", "是否必填", "说明"],
    ["分镜名称", "否", "这一镜的名字，会作为任务列表名称和素材库分镜目录名"],
    ["视频提示词", "是", "一段话描述画面、主体动作、镜头与光线"],
    ["参考图（按顺序）", "否", "绝对路径，或相对素材库的文件名；多个用英文分号 ; 分隔，顺序就是图一到图九"],
    ["参考图说明（按顺序）", "否", "与参考图一一对应，说明这张图是什么（角色 / 首帧 / 场景）"],
    ["视频画幅", "否", "16:9 / 9:16 / 1:1 / 4:3 / 3:4；留空使用渠道默认值"],
    ["视频时长", "否", "1–15 的整数秒；留空使用渠道默认值"],
    ["", "", ""],
    ["注意", "", "表头按列名识别，顺序可以调整；多出来的列会原样保留并在页面上提示"],
    ["", "", "参考图路径不存在时，解析会在页面上标出具体行号，不会静默忽略"],
]

NOTE_LINES = [
    "本文件只支持固定结构：顶层 items 数组，一条任务一个元素；单条任务也只放一行。",
    "字段：分镜名称 title、视频提示词 prompt、参考图 images（按数组顺序对应图一到图九）、视频画幅 ratio、视频时长 duration。",
    "参考图写在 images 里：path 为绝对路径（或相对素材库的路径），note 说明这张图是什么。",
    "ratio / duration 可留空，留空时使用创建页所选渠道的默认值。",
]


# ------------------------------- 文本解析 -------------------------------

def read_text(path):
    return Path(path).read_text(encoding="utf-8-sig")


def split_records(text):
    """按 *::~XXX::~* 标记切分；START 开始，RECORD/END 收尾。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    records, cur = [], None
    for line in text.split("\n"):
        m = MARKER_RE.match(line.strip())
        if m:
            kind = m.group(1).upper()
            if "START" in kind:
                cur = []
            elif cur is not None:
                if any(x.strip() for x in cur):
                    records.append(cur)
                cur = None if "END" in kind else []
            continue
        if cur is not None:
            cur.append(line)
    if cur and any(x.strip() for x in cur):
        records.append(cur)
    return records


def field_of(block, key):
    for line in block:
        m = FIELD_RE.match(line.strip())
        if m and m.group(1) == key:
            return m.group(2).strip()
    return ""


def clean_name(value):
    return re.sub(r"[（(][^）)]*[）)]", "", value).strip()


def split_names(raw):
    if not raw:
        return []
    return [clean_name(x) for x in LIST_SPLIT.split(raw) if clean_name(x)]


def extract_duration(block):
    raw = field_of(block, "时长")
    if raw:
        m = re.search(r"(\d+)", raw)
        if m:
            return int(m.group(1)), None
        return None, "「时长」字段不是数字：%s" % raw
    spans = re.findall(r"\[\s*(\d+)\s*[-–]\s*(\d+)\s*秒\s*\]", "\n".join(block))
    if spans:
        return max(int(b) for _, b in spans), None
    return None, "没有「时长：」字段，也没有 [a-b秒] 时间分段，时长留空"


def clean_scene(value):
    value = re.split(r"[｜|]", value)[0]
    return value.strip(" ：:")


# ------------------------------- 素材匹配 -------------------------------

def list_images(folder):
    folder = Path(folder)
    if not folder.is_dir():
        return []
    return sorted(
        [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_EXT],
        key=lambda p: p.name,
    )


def match_prefix(files, name):
    hits = []
    for f in files:
        s = f.stem
        if s == name or s.startswith(name + "_") or s.startswith(name + "-") or s.startswith(name + " ") \
                or s.startswith(name + "（") or s.startswith(name + "("):
            hits.append(f)
    return hits


def hair_states(records):
    """逐条推断造型状态：long / short / both；没写头发时继承上一条。"""
    states, state = [], "long"
    for block in records:
        text = "\n".join(block)
        has_short = "短发" in text
        has_long = ("长发" in text) or ("杀马特" in text)
        if has_short and has_long:
            states.append("both")
            state = "short"
        elif has_short:
            states.append("short")
            state = "short"
        elif has_long:
            states.append("long")
            state = "long"
        else:
            states.append(state)
    return states


def pick_variant(files, state, name, warnings, line_no):
    """同一角色有多张图时：按造型状态选；both 表示剪发那一镜，前后两张都给。
    返回 [(文件, 造型标签)]，标签只用于 note。"""
    if len(files) <= 1:
        return [(f, "") for f in files]
    short = [f for f in files if "短发" in f.stem]
    long_ = [f for f in files if "短发" not in f.stem]
    best = lambda xs: min(xs, key=lambda f: (len(f.stem), f.stem))
    if state == "both" and short and long_:
        warnings.append("第 %d 条：本镜包含剪发前后两种造型，已同时挂上「%s」长发/短发两张参考图" % (line_no, name))
        return [(best(long_), "长发"), (best(short), "短发")]
    if state == "short" and short:
        return [(best(short), "短发")]
    if state == "long" and long_:
        return [(best(long_), "长发")]
    warnings.append(
        "第 %d 条：角色「%s」有 %d 张候选图，无法判断造型，已取文件名最短的一张（可在 mapping.json 的 character_pins 里固定）"
        % (line_no, name, len(files))
    )
    return [(best(files), "")]


def scene_label(stem):
    s = re.sub(r"^\d+[_-]", "", stem)
    s = re.sub(r"_2026版.*$", "", s)
    s = re.sub(r"_四视图.*$", "", s)
    s = re.sub(r"_\d+x\d+.*$", "", s)
    return s


def find_scene(files, target):
    exact = [f for f in files if scene_label(f.stem) == target]
    if exact:
        return exact
    return [f for f in files if target in f.stem]


# ------------------------------- 组装任务 -------------------------------

def tag_list_line(line, field, groups):
    """把 `场景：A、B` / `角色：A、B` 的每个片段前插入 <Picture n>。"""
    m = re.match(r"^(\s*%s\s*[：:])([\s\S]*)$" % re.escape(field), line)
    if not m:
        return line
    head, body = m.group(1), m.group(2)
    parts = re.split(r"([、,，;；])", body)
    segs, seps = parts[0::2], parts[1::2]
    tagged, gi = [], 0
    for seg in segs:
        tags = groups[gi] if gi < len(groups) else ""
        gi += 1
        if seg.strip() and tags:
            tagged.append(tags + seg.strip())
        else:
            tagged.append(seg)
    out = tagged[0] if tagged else ""
    for k, sep in enumerate(seps):
        out += sep + (tagged[k + 1] if k + 1 < len(tagged) else "")
    return head + out


def tag_voice_line(line, name_tags):
    """`音色锁定：林辰：...；赵庭香：...` 每条角色音色前插入 <Picture n>。"""
    m = re.match(r"^(\s*音色锁定\s*[：:])([\s\S]*)$", line)
    if not m:
        return line
    head, body = m.group(1), m.group(2)
    for name in sorted(name_tags, key=len, reverse=True):
        tags = name_tags[name]
        if tags and (name + "：") in body:
            body = body.replace(name + "：", tags + name + "：", 1)
    return head + body


def inject_picture_tags(prompt, char_groups, scene_groups, name_tags):
    """只改 场景 / 角色 / 音色锁定 三个开头的行，其余原样。"""
    lines = []
    for line in prompt.split("\n"):
        if "<Picture" in line:
            lines.append(line)
            continue
        stripped = line.strip()
        if stripped.startswith("场景："):
            lines.append(tag_list_line(line, "场景", scene_groups))
        elif stripped.startswith("角色："):
            lines.append(tag_list_line(line, "角色", char_groups))
        elif stripped.startswith("音色锁定："):
            lines.append(tag_voice_line(line, name_tags))
        else:
            lines.append(line)
    return "\n".join(lines)


def build_items(records, args, mapping, char_files, scene_files):
    items, warnings, errors = [], [], []
    aliases = mapping.get("aliases") or {}
    scene_map = mapping.get("scenes") or {}
    pins = mapping.get("character_pins") or {}

    states = hair_states(records)
    for idx, block in enumerate(records):
        line_no = idx + 1
        prompt = "\n".join(block).strip()
        if not prompt:
            errors.append("第 %d 条：提示词为空" % line_no)
            continue

        duration, warn = extract_duration(block)
        if warn:
            warnings.append("第 %d 条：%s" % (line_no, warn))
        if duration is not None and not (1 <= duration <= 15):
            warnings.append("第 %d 条：时长 %s 秒不在 1–15，已留空" % (line_no, duration))
            duration = None

        images, seen = [], {}

        def add(path, note_fn):
            key = str(path).lower()
            if key in seen:
                return seen[key]
            number = len(images) + 1
            seen[key] = number
            images.append({"path": Path(path).as_posix(), "note": note_fn(number)})
            return number

        char_groups, scene_groups, name_tags = [], [], {}

        char_raw = field_of(block, "角色")
        char_segs = re.split(r"([、,，;；])", char_raw)[0::2] if char_raw else []
        for raw_seg in char_segs:
            name = clean_name(raw_seg)
            if not name:
                char_groups.append("")
                continue
            target = aliases.get(name, name)
            pin = pins.get(target) or pins.get(name)
            if pin:
                candidates = [p for p in ([Path(pin)] if Path(pin).is_absolute() else [Path(args.char_dir) / pin]) if p.is_file()]
            else:
                candidates = match_prefix(char_files, target)
            if not candidates:
                warnings.append("第 %d 条：素材库里找不到角色「%s」的图，已跳过" % (line_no, name))
                char_groups.append("")
                continue
            chosen = pick_variant(candidates, states[idx], name, warnings, line_no)
            tags = ""
            for f, kind in chosen:
                number = add(f, lambda n, name=name, kind=kind: "<Picture %d> 角色：%s%s" % (n, name, ("（%s）" % kind) if kind else ""))
                tags += "<Picture %d>" % number
            char_groups.append(tags)
            name_tags[name] = tags

        scene_raw = field_of(block, "场景")
        scene_segs = re.split(r"([、,，;；])", scene_raw)[0::2] if scene_raw else []
        for raw_seg in scene_segs:
            part = clean_scene(raw_seg)
            if not part:
                scene_groups.append("")
                continue
            targets = scene_map.get(part)
            if targets is None:
                direct = find_scene(scene_files, part)
                if direct:
                    targets = [scene_label(direct[0].stem)]
                else:
                    pieces = [p for p in re.split(r"[及和与]", part) if p]
                    targets = []
                    for piece in pieces:
                        hit = find_scene(scene_files, piece)
                        if hit:
                            targets.append(scene_label(hit[0].stem))
                    if not targets:
                        warnings.append("第 %d 条：素材库里找不到场景「%s」的图，已跳过" % (line_no, part))
                        scene_groups.append("")
                        continue
            tags = ""
            for target in targets:
                hits = find_scene(scene_files, target)
                if not hits:
                    warnings.append("第 %d 条：素材库里找不到场景「%s」的图，已跳过" % (line_no, target))
                    continue
                label = scene_label(hits[0].stem)
                number = add(hits[0], lambda n, label=label: "<Picture %d> 场景：%s" % (n, label))
                tags += "<Picture %d>" % number
            scene_groups.append(tags)

        if len(images) > MAX_IMAGES:
            warnings.append("第 %d 条：参考图 %d 张，超过 %d 张，已截断；提示词里超出 9 的 <Picture n> 需要手工处理" % (line_no, len(images), MAX_IMAGES))
            images = images[:MAX_IMAGES]

        prompt = inject_picture_tags(prompt, char_groups, scene_groups, name_tags)
        if len(prompt) > MAX_PROMPT:
            errors.append("第 %d 条：加标签后提示词 %d 字，超过 %d 字上限" % (line_no, len(prompt), MAX_PROMPT))

        title = "%s%0*d" % (args.title_prefix, args.pad, args.start_at + idx)
        items.append({
            "title": title,
            "prompt": prompt,
            "images": images,
            "duration": duration,
            "ratio": args.ratio,
        })
    return items, warnings, errors


# ------------------------------- 输出 -------------------------------

def write_json(path, items):
    doc = {"version": 1, "说明": NOTE_LINES, "items": items}
    Path(path).write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_xlsx(path, items):
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
        from openpyxl.utils import get_column_letter
    except ImportError:
        write_xlsx_plain(path, items)
        return False

    widths = [13, 78, 60, 32, 10, 10]
    wb = Workbook()
    ws = wb.active
    ws.title = "任务"
    thin = Side(style="thin", color="B7C4D6")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)
    head_fill = PatternFill("solid", fgColor="1F4E79")
    head_font = Font(name="微软雅黑", bold=True, color="FFFFFF", size=11)
    body_font = Font(name="微软雅黑", size=10)

    for c, h in enumerate(HEADERS, 1):
        cell = ws.cell(row=1, column=c, value=h)
        cell.font = head_font
        cell.fill = head_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = border

    def disp_width(s):
        return sum(2 if ord(ch) > 127 else 1 for ch in s)

    def estimate(text, width):
        total = 0
        for line in str(text).split("\n"):
            total += max(1, (disp_width(line) + int(width * 1.05) - 1) // int(width * 1.05))
        return total

    for i, item in enumerate(items, 2):
        paths = ";".join(img["path"] for img in item["images"])
        notes = ";".join(img["note"] for img in item["images"])
        row = [item["title"], item["prompt"], paths, notes, item["ratio"], item["duration"]]
        for c, v in enumerate(row, 1):
            cell = ws.cell(row=i, column=c, value=v)
            cell.font = body_font
            cell.border = border
            cell.alignment = Alignment(
                horizontal="center" if c in (1, 5, 6) else "left", vertical="top", wrap_text=True)
        lines = max(estimate(item["prompt"], widths[1]), estimate(paths, widths[2]), estimate(notes, widths[3]))
        ws.row_dimensions[i].height = min(409, max(28, lines * 14.5))

    for c, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(c)].width = w
    ws.row_dimensions[1].height = 26
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:F%d" % (len(items) + 1)

    ws2 = wb.create_sheet("填写说明")
    for r, row in enumerate(HELP_ROWS, 1):
        for c, v in enumerate(row, 1):
            cell = ws2.cell(row=r, column=c, value=v)
            cell.font = Font(name="微软雅黑", size=10, bold=(r == 1))
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            if r == 1:
                cell.fill = PatternFill("solid", fgColor="DCE6F1")
    ws2.column_dimensions["A"].width = 20
    ws2.column_dimensions["B"].width = 12
    ws2.column_dimensions["C"].width = 74

    wb.save(path)
    return True


def write_xlsx_plain(path, items):
    """没有 openpyxl 时的兜底：标准 xlsx，无样式。"""

    def esc(value):
        s = str(value)
        s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
        return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s)

    def col_name(n):
        s = ""
        while n > 0:
            n, r = divmod(n - 1, 26)
            s = chr(65 + r) + s
        return s

    def sheet_xml(rows):
        body = []
        for r, row in enumerate(rows, 1):
            cells = []
            for c, v in enumerate(row, 1):
                if v is None or v == "":
                    continue
                cells.append(
                    '<c r="%s%d" t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>'
                    % (col_name(c), r, esc(v))
                )
            body.append('<row r="%d">%s</row>' % (r, "".join(cells)))
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
            + "".join(body)
            + "</sheetData></worksheet>"
        )

    task_rows = [HEADERS] + [
        [it["title"], it["prompt"], ";".join(i["path"] for i in it["images"]),
         ";".join(i["note"] for i in it["images"]), it["ratio"], it["duration"]]
        for it in items
    ]
    sheets = [("任务", task_rows), ("填写说明", HELP_ROWS)]
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   + "".join('<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' % (i + 1) for i in range(len(sheets)))
                   + "</Types>")
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
                   "</Relationships>")
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join('<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (name, i + 1, i + 1) for i, (name, _) in enumerate(sheets))
                   + "</sheets></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join('<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>' % (i + 1, i + 1) for i in range(len(sheets)))
                   + "</Relationships>")
        for i, (_, rows) in enumerate(sheets):
            z.writestr("xl/worksheets/sheet%d.xml" % (i + 1), sheet_xml(rows))


# ------------------------------- 入口 -------------------------------

def main(argv=None):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

    default_map = Path(__file__).resolve().parent.parent / "mapping.json"
    ap = argparse.ArgumentParser(description="分镜提示词文本 -> 标准任务 JSON + Excel")
    ap.add_argument("--input", required=True, help="分镜文本（.txt）")
    ap.add_argument("--assets", required=True, help="素材库根目录（其下有 人物/ 场景/，或直接放图片）")
    ap.add_argument("--out", default=".", help="输出目录，默认当前目录")
    ap.add_argument("--map", default=str(default_map), help="mapping.json 路径")
    ap.add_argument("--name", default="", help="输出文件名（不含扩展名），默认取输入文件名")
    ap.add_argument("--ratio", default="16:9", choices=RATIOS, help="画幅，默认 16:9")
    ap.add_argument("--title-prefix", default="镜头 ", help="标题前缀，默认「镜头 」")
    ap.add_argument("--start-at", type=int, default=1, help="起始编号，默认 1")
    ap.add_argument("--pad", type=int, default=2, help="编号位数，默认 2")
    ap.add_argument("--report", default="", help="把汇总写到指定 JSON 文件")
    args = ap.parse_args(argv)

    text = read_text(args.input)
    records = split_records(text)
    if not records:
        print("× 没有解析到任何记录：请确认文件里有 *::~RECORD::~* 分隔块。", file=sys.stderr)
        return 2

    mapping = {}
    map_path = Path(args.map)
    if map_path.is_file():
        mapping = json.loads(map_path.read_text(encoding="utf-8-sig"))
    else:
        print("! 没有找到 mapping.json，使用空映射（只按文件名前缀匹配）")

    assets = Path(args.assets)
    if not assets.is_dir():
        print("× 素材库不存在：%s" % assets, file=sys.stderr)
        return 2
    char_dir = assets / "人物"
    scene_dir = assets / "场景"
    all_files = []
    if not char_dir.is_dir() or not scene_dir.is_dir():
        all_files = list_images(assets)
    char_files = list_images(char_dir) if char_dir.is_dir() else all_files
    scene_files = list_images(scene_dir) if scene_dir.is_dir() else all_files
    if not char_files:
        print("× 素材库里没有图片：%s" % assets, file=sys.stderr)
        return 2
    args.char_dir = char_dir

    items, warnings, errors = build_items(records, args, mapping, char_files, scene_files)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = args.name or Path(args.input).stem
    json_path = out_dir / (stem + ".json")
    xlsx_path = out_dir / (stem + ".xlsx")

    write_json(json_path, items)
    styled = write_xlsx(xlsx_path, items)

    total_images = sum(len(it["images"]) for it in items)
    total_duration = sum(it["duration"] or 0 for it in items)
    print("✓ %d 条任务 · %d 张参考图 · 总时长 %d 秒" % (len(items), total_images, total_duration))
    print("  JSON  %s" % json_path)
    print("  Excel %s%s" % (xlsx_path, "" if styled else "（无 openpyxl，已用无样式兜底）"))
    for w in warnings:
        print("  ! " + w)
    for e in errors:
        print("  × " + e, file=sys.stderr)

    if args.report:
        Path(args.report).write_text(json.dumps({
            "input": str(Path(args.input).resolve()),
            "assets": str(assets.resolve()),
            "outputs": [str(json_path.resolve()), str(xlsx_path.resolve())],
            "items": len(items),
            "images": total_images,
            "duration_total": total_duration,
            "warnings": warnings,
            "errors": errors,
        }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
