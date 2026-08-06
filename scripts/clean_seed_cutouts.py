# -*- coding: utf-8 -*-
"""見本の服の画像を整える。2つのことをする。

【1】壊れた PNG チャンクの修復
    `public/seed/` の26枚は **すべて `eXIf` チャンクの CRC が壊れている**
    (`broken PNG file (bad header checksum in eXIf)`)。ブラウザは CRC を見ないので
    表示できてしまい、長らく気付かれていなかったが、厳密なデコーダ(Pillow など)は
    開けない。サーバー側で画像を触る処理を足した瞬間に壊れる地雷なので直しておく。
    ついでに Apple の私的チャンク `caBX`(1枚あたり最大72KB!)やメタデータも落とす。
    **画素は一切触らない**——表示に要らないチャンクを外して CRC を付け直すだけ。

【2】切り抜きに残った「隣の服のかけら」の除去
    見本は1枚のカタログ写真から切り出したもので、いくつかに隣の服の断片が残っている
    (例: men/gray-slacks.png の右side の黒い影)。服を大きく見せる「全身コーデ」表示を
    入れると、この破片がはっきり見えてしまう。
    不透明な画素をつないで塊に分け、**いちばん大きい塊だけ残す**。服そのものは必ず
    1つの大きな塊になるので、離れた小さな破片だけが消える。

元に戻したくなったら `git checkout -- public/seed` で戻せる(リポジトリ管理下)。

使い方(既定は確認のみ。--apply で実際に上書きする):
    python scripts/clean_seed_cutouts.py
    python scripts/clean_seed_cutouts.py --apply
"""
import os
import struct
import sys
import zlib

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "seed")
APPLY = "--apply" in sys.argv

# 表示に必要 / 害のないチャンクだけ残す。これ以外(eXIf, caBX, tEXt など)は落とす。
KEEP_CHUNKS = {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND", b"sRGB", b"gAMA", b"cHRM", b"sBIT"}

# 最大の塊に対してこれ未満の塊は「別の服のかけら」とみなして消す。
# ボタンや紐が本体から完全に分離している場合に消えないよう、少し余裕を持たせている。
KEEP_RATIO = 0.12
# 半透明のふちを拾わないための不透明しきい値。
ALPHA_MIN = 24


def repair_png(raw: bytes) -> tuple[bytes, list[str]]:
    """不要チャンクを外し、CRCを付け直した PNG を返す。画素は変えない。"""
    out = bytearray(raw[:8])
    dropped: list[str] = []
    i = 8
    while i + 8 <= len(raw):
        length = struct.unpack(">I", raw[i : i + 4])[0]
        ctype = raw[i + 4 : i + 8]
        data = raw[i + 12 - 4 : i + 8 + length]
        if ctype in KEEP_CHUNKS:
            out += struct.pack(">I", length) + ctype + data
            out += struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)
        else:
            dropped.append(ctype.decode("latin1"))
        i += 12 + length
        if ctype == b"IEND":
            break
    return bytes(out), dropped


def components(mask: np.ndarray):
    """4近傍の連結成分にラベルを振る。ラベル配列と、ラベルごとの面積を返す。"""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    areas = {0: 0}
    current = 0
    # 反復版の flood fill。再帰だと画像サイズによっては深さ制限に当たる。
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or labels[sy, sx]:
                continue
            current += 1
            stack = [(sy, sx)]
            labels[sy, sx] = current
            area = 0
            while stack:
                y, x = stack.pop()
                area += 1
                for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    ny, nx = y + dy, x + dx
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = current
                        stack.append((ny, nx))
            areas[current] = area
    return labels, areas


def process(path: str) -> str | None:
    with open(path, "rb") as f:
        raw = f.read()
    before = len(raw)

    repaired, dropped = repair_png(raw)
    notes: list[str] = []
    if dropped:
        notes.append(f"チャンク除去 {'/'.join(sorted(set(dropped)))}")

    # 修復した中身で読み込む(元のままだと Pillow が開けない)。
    tmp = os.path.join(os.path.dirname(path), f".__tmp_{os.path.basename(path)}")
    with open(tmp, "wb") as f:
        f.write(repaired)
    try:
        img = Image.open(tmp).convert("RGBA")
        arr = np.array(img)
    finally:
        os.remove(tmp)

    alpha = arr[:, :, 3]
    mask = alpha >= ALPHA_MIN
    if mask.any():
        labels, areas = components(mask)
        biggest = max((a for k, a in areas.items() if k), default=0)
        drop = [k for k, a in areas.items() if k and a < biggest * KEEP_RATIO]
        if drop:
            removed = sum(areas[k] for k in drop)
            for k in drop:
                arr[labels == k, 3] = 0
            notes.append(f"断片{len(drop)}個 ({removed / int(mask.sum()) * 100:.1f}%) を除去")

    if not notes:
        return None

    if APPLY:
        Image.fromarray(arr, "RGBA").save(path, optimize=True)
        after = os.path.getsize(path)
        notes.append(f"{before / 1024:.0f}KB→{after / 1024:.0f}KB")
    return " / ".join(notes)


def main() -> None:
    changed = 0
    for sub in ("men", "women"):
        d = os.path.join(ROOT, sub)
        if not os.path.isdir(d):
            continue
        for name in sorted(os.listdir(d)):
            if not name.lower().endswith(".png"):
                continue
            note = process(os.path.join(d, name))
            if note:
                changed += 1
                print(f"  {sub}/{name}: {note}")
    verb = "処理しました" if APPLY else "処理が必要です(--apply で実行)"
    print(f"\n{changed} 枚を{verb}")


if __name__ == "__main__":
    main()
