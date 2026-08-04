# -*- coding: utf-8 -*-
"""公式サンプルアカウント(デモユーザー)の投入スクリプト。

ユーザーがゼロの期間でもアプリが寂しくならないよう、架空の6人
(女性3・男性3、10代後半〜20代後半、系統バラバラ)を作り、
2択・全身コーデ投稿(置き画ボード)・投票・理由スタンプ・コメント・いいねを
まとめて Firestore に書き込む。Kazさん依頼(2026-08-04)。

方針:
- 人物写真は一切使わない。アバターはフラットイラスト(SVG)、投稿は服の
  「置き画ボード」+「本人が着ている着用画」(アバターと同じ配色のフラット
  イラスト。2026-08-04 Kazさん依頼で全員1枚ずつ追加)。
  架空であることが視覚的にも伝わるようにする。
- プロフィールと投稿本文の両方に「実在しない」ことを明記する。
- ブランドはすべて架空の「MC STUDIO」。アイテムタグ・値段公開のお手本を兼ねる。
- ドキュメントIDはすべて demo_ 始まりの固定値。**再実行すると同じIDに上書き**され、
  重複しない。消したいときは users / closetItems / stylePosts / outfitPosts /
  follows から demo_ 始まりのドキュメントを削除すればよい。

使い方(PowerShell):
  $env:GTOKEN = (gcloud auth print-access-token)
  python scripts/seed_demo_accounts.py

Admin 権限(gcloud のオーナートークン)で REST を直接叩くので、
firestore.rules の制限(official や plan の書き込み禁止)は適用されない。
official: true は運営が付ける認証バッジの正規の使い方。
"""

import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error

PROJECT = "my-clothes-46c81"
BUCKET = "my-clothes-46c81.firebasestorage.app"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEED_DIR = os.path.join(REPO, "public", "seed")

TOKEN = os.environ.get("GTOKEN", "").strip()
if not TOKEN:
    print("環境変数 GTOKEN が空です。 $env:GTOKEN = (gcloud auth print-access-token) を先に実行してください。")
    sys.exit(1)

NOW = int(time.time() * 1000)
HOUR = 3600 * 1000
DAY = 24 * HOUR

DISCLAIMER = "※アプリ公式のサンプルアカウントです。人物・ブランド(MC STUDIO)は実在しません。"


# ---------------------------------------------------------------- REST helpers

def _request(url: str, data: bytes | None, method: str, content_type: str):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if content_type:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"{method} {url} -> {e.code}: {body[:500]}") from e


def to_fs(value):
    """Python の値を Firestore REST の Value 形式へ。"""
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {"arrayValue": {"values": [to_fs(v) for v in value]}}
    if isinstance(value, dict):
        return {"mapValue": {"fields": {k: to_fs(v) for k, v in value.items()}}}
    raise TypeError(f"unsupported: {type(value)}")


def set_doc(path: str, data: dict):
    """setDoc 相当(全フィールド上書き)。path 例: 'users/demo_aoi'"""
    url = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/{path}"
    body = json.dumps({"fields": {k: to_fs(v) for k, v in data.items()}}).encode("utf-8")
    _request(url, body, "PATCH", "application/json")
    print(f"  firestore: {path}")


def upload_public(path: str, data: bytes, content_type: str) -> str:
    """Storage へ公開オブジェクトとしてアップロードし、公開URLを返す。

    cacheControl を明示するのが重要。付けないと ``private, max-age=0`` で配信され、
    画面を開くたびにブラウザが同じ画像を取り直す(アプリ側の uploadImage と同じ理由。
    ファイル名は固定IDだが、内容が変わるのは再投入したときだけなので1時間にしてある)。
    """
    name = urllib.request.quote(path, safe="")
    url = (
        f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o"
        f"?uploadType=media&name={name}&predefinedAcl=publicRead"
    )
    _request(url, data, "POST", content_type)
    # cacheControl はアップロードのクエリでは指定できないので、直後に metadata を更新する。
    _request(
        f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{name}",
        json.dumps({"cacheControl": "public, max-age=3600"}).encode("utf-8"),
        "PATCH",
        "application/json",
    )
    public = f"https://storage.googleapis.com/{BUCKET}/{path}"
    print(f"  storage:   {public}")
    return public


def seed_png_b64(rel: str) -> tuple[str, tuple[int, int]]:
    """public/seed/ 配下のPNGを base64 で読む。サイズはPNGヘッダから取る。"""
    fp = os.path.join(SEED_DIR, rel.replace("/", os.sep))
    with open(fp, "rb") as f:
        raw = f.read()
    # PNG の IHDR から width/height(ビッグエンディアン)
    w = int.from_bytes(raw[16:20], "big")
    h = int.from_bytes(raw[20:24], "big")
    return base64.b64encode(raw).decode("ascii"), (w, h)


# ---------------------------------------------------------------- avatar SVGs

def avatar_svg(bg, skin, hair, top, back_hair, front_hair, extra=""):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
<defs><clipPath id="c"><circle cx="120" cy="120" r="120"/></clipPath></defs>
<g clip-path="url(#c)">
<rect width="240" height="240" fill="{bg}"/>
{back_hair}
<path d="M56 240 C56 188 86 170 120 170 C154 170 184 188 184 240 Z" fill="{top}"/>
<rect x="107" y="146" width="26" height="28" rx="11" fill="{skin}" opacity="0.92"/>
<ellipse cx="120" cy="112" rx="45" ry="49" fill="{skin}"/>
{front_hair}
<circle cx="103" cy="119" r="4.4" fill="#38302a"/>
<circle cx="137" cy="119" r="4.4" fill="#38302a"/>
<circle cx="93" cy="133" r="7" fill="#ef9f9f" opacity="0.45"/>
<circle cx="147" cy="133" r="7" fill="#ef9f9f" opacity="0.45"/>
<path d="M112 139 Q120 146 128 139" stroke="#b4685f" stroke-width="3" fill="none" stroke-linecap="round"/>
{extra}
</g>
</svg>"""


AVATARS = {
    "demo_aoi": avatar_svg(  # ボブ・カジュアル
        "#dbeafe", "#f6d7c0", "#4a3628", "#7da7d9",
        back_hair='<path d="M52 118 a68 68 0 1 1 136 0 v34 q0 18 -18 18 h-100 q-18 0 -18 -18 z" fill="#4a3628"/>',
        front_hair='<path d="M74 108 Q76 60 120 58 Q164 60 166 108 Q150 82 120 82 Q90 82 74 108 Z" fill="#4a3628"/>',
    ),
    "demo_rin": avatar_svg(  # 黒髪ロング・きれいめ
        "#f5e6e8", "#f2cdb5", "#2c2624", "#2f3640",
        back_hair='<path d="M60 102 Q60 46 120 46 Q180 46 180 102 L186 216 Q150 200 120 204 Q90 200 54 216 Z" fill="#2c2624"/>',
        front_hair='<path d="M73 110 Q73 58 120 56 Q167 58 167 110 Q159 78 133 76 Q125 88 120 88 Q115 88 107 76 Q81 78 73 110 Z" fill="#2c2624"/>',
        extra='<circle cx="76" cy="128" r="3" fill="#d9b64f"/><circle cx="164" cy="128" r="3" fill="#d9b64f"/>',
    ),
    "demo_hinano": avatar_svg(  # ツインお団子・ガーリー
        "#fdeef3", "#f8dcc8", "#8a5a3b", "#e26d6d",
        back_hair=(
            '<circle cx="66" cy="56" r="24" fill="#8a5a3b"/><circle cx="174" cy="56" r="24" fill="#8a5a3b"/>'
            '<path d="M54 116 a66 66 0 1 1 132 0 v30 q0 16 -16 16 h-100 q-16 0 -16 -16 z" fill="#8a5a3b"/>'
        ),
        front_hair='<path d="M76 106 Q78 62 120 60 Q162 62 164 106 Q148 82 120 84 Q92 82 76 106 Z" fill="#8a5a3b"/>',
        extra='<circle cx="66" cy="38" r="6" fill="#f2b6c6"/><circle cx="174" cy="38" r="6" fill="#f2b6c6"/>',
    ),
    "demo_yuto": avatar_svg(  # 黒マッシュ・ストリート
        "#e8f0e4", "#e8c39e", "#26221f", "#33415c",
        back_hair='<path d="M58 120 Q52 50 120 48 Q188 50 182 120 v18 h-124 z" fill="#26221f"/>',
        front_hair='<path d="M64 120 Q58 54 120 52 Q182 54 176 120 Q170 92 120 90 Q70 92 64 120 Z" fill="#26221f"/>',
    ),
    "demo_kai": avatar_svg(  # センターパート・きれいめ
        "#e9e7f5", "#f2cdb5", "#3b2f26", "#f2f2f0",
        back_hair='<path d="M62 116 Q60 52 120 50 Q180 52 178 116 v14 h-116 z" fill="#3b2f26"/>',
        front_hair='<path d="M70 106 Q72 56 120 54 Q168 56 170 106 Q168 78 128 74 L120 84 L112 74 Q72 78 70 106 Z" fill="#3b2f26"/>',
        extra='<path d="M100 176 L120 200 L140 176" stroke="#c9c9c4" stroke-width="4" fill="none"/>',
    ),
    "demo_sora": avatar_svg(  # ゆるパーマ・ナチュラル
        "#f3ecdf", "#e0b48f", "#5d4630", "#d9d2c5",
        back_hair=(
            '<circle cx="78" cy="80" r="26" fill="#5d4630"/><circle cx="106" cy="62" r="26" fill="#5d4630"/>'
            '<circle cx="136" cy="62" r="26" fill="#5d4630"/><circle cx="164" cy="80" r="26" fill="#5d4630"/>'
            '<circle cx="68" cy="108" r="20" fill="#5d4630"/><circle cx="172" cy="108" r="20" fill="#5d4630"/>'
        ),
        front_hair='<path d="M76 102 Q80 64 120 62 Q160 64 164 102 Q146 80 120 80 Q94 80 76 102 Z" fill="#5d4630"/>',
    ),
}


# ---------------------------------------------------------------- board SVGs

def board_svg(bg, accent, title_note, items, footer):
    """置き画ボード(900x1200・3:4)。items = [(b64, (w,h), label, price, x, y, cw, ch, rot)]"""
    cards = []
    for b64, (iw, ih), label, price, x, y, cw, ch, rot in items:
        box_w, box_h = cw - 44, ch - 116
        scale = min(box_w / iw, box_h / ih)
        dw, dh = iw * scale, ih * scale
        dx, dy = (cw - dw) / 2, 26 + (box_h - dh) / 2
        cards.append(f"""<g transform="translate({x} {y}) rotate({rot} {cw / 2} {ch / 2})">
<rect width="{cw}" height="{ch}" rx="26" fill="#ffffff" stroke="#00000012"/>
<image x="{dx:.0f}" y="{dy:.0f}" width="{dw:.0f}" height="{dh:.0f}" preserveAspectRatio="xMidYMid meet" href="data:image/png;base64,{b64}"/>
<text x="{cw / 2}" y="{ch - 62}" text-anchor="middle" font-size="26" font-weight="bold" fill="#3d3630" font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">{label}</text>
<text x="{cw / 2}" y="{ch - 28}" text-anchor="middle" font-size="24" fill="{accent}" font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">MC STUDIO ・ ¥{price:,}</text>
</g>""")
    cards_svg = "\n".join(cards)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200">
<rect width="900" height="1200" fill="{bg}"/>
<circle cx="70" cy="1130" r="150" fill="#ffffff" opacity="0.35"/>
<circle cx="850" cy="120" r="120" fill="#ffffff" opacity="0.35"/>
<text x="60" y="110" font-size="64" font-weight="bold" letter-spacing="6" fill="#3d3630" font-family="Georgia,'Times New Roman',serif">MC STUDIO</text>
<text x="60" y="152" font-size="26" fill="#6b625a" font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">OFFICIAL SAMPLE ── {title_note}</text>
<text x="60" y="190" font-size="22" fill="#8a8178" font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">このブランド・人物は実在しません(アプリ公式のサンプル投稿)</text>
{cards_svg}
<text x="450" y="1172" text-anchor="middle" font-size="26" font-weight="bold" fill="#6b625a" font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">{footer}</text>
</svg>"""


# ---------------------------------------------------------------- wearing SVGs
# 「本人が着ている着用画」(Kazさん依頼 2026-08-04)。
# 人物写真は一切使わない方針はそのまま、アバターと同じ配色のフラットイラストで
# 全身の着用イメージを描く。服の色はクローゼットの実物写真の色味に合わせている。
# 座標系: 900x1200。頭の中心 (450,320)、肩 y≈475、パンツ裾 y≈1016(全体を +26 下げて配置)。

def _gingham_defs(pid: str, base: str, line: str) -> str:
    return (
        f'<pattern id="{pid}" width="26" height="26" patternUnits="userSpaceOnUse">'
        f'<rect width="26" height="26" fill="{base}"/>'
        f'<rect width="13" height="26" fill="{line}" opacity="0.45"/>'
        f'<rect width="26" height="13" fill="{line}" opacity="0.45"/>'
        f"</pattern>"
    )


def _neck(skin):
    return f'<rect x="428" y="382" width="44" height="52" rx="18" fill="{skin}"/>'


def _arms(color, sleeve, skin):
    """腕。round-cap の太い線で肩→手首。sleeve: long / short / none(素肌)"""
    if sleeve == "long":
        return (
            f'<path d="M392 474 Q352 522 350 660" stroke="{color}" stroke-width="46" stroke-linecap="round" fill="none"/>'
            f'<path d="M508 474 Q548 522 550 660" stroke="{color}" stroke-width="46" stroke-linecap="round" fill="none"/>'
            f'<circle cx="350" cy="674" r="17" fill="{skin}"/><circle cx="550" cy="674" r="17" fill="{skin}"/>'
        )
    if sleeve == "short":
        return (
            f'<path d="M394 478 Q360 502 356 554" stroke="{color}" stroke-width="50" stroke-linecap="round" fill="none"/>'
            f'<path d="M506 478 Q540 502 544 554" stroke="{color}" stroke-width="50" stroke-linecap="round" fill="none"/>'
            f'<path d="M354 566 L350 650" stroke="{skin}" stroke-width="32" stroke-linecap="round" fill="none"/>'
            f'<path d="M546 566 L550 650" stroke="{skin}" stroke-width="32" stroke-linecap="round" fill="none"/>'
            f'<circle cx="350" cy="666" r="16" fill="{skin}"/><circle cx="550" cy="666" r="16" fill="{skin}"/>'
        )
    return (
        f'<path d="M396 472 Q356 512 350 654" stroke="{skin}" stroke-width="34" stroke-linecap="round" fill="none"/>'
        f'<path d="M504 472 Q544 512 550 654" stroke="{skin}" stroke-width="34" stroke-linecap="round" fill="none"/>'
        f'<circle cx="350" cy="664" r="16" fill="{skin}"/><circle cx="550" cy="664" r="16" fill="{skin}"/>'
    )


def _torso(fill, hem=664, detail=""):
    return f'<path d="M382 452 Q450 476 518 452 L528 {hem - 16} Q450 {hem + 16} 372 {hem - 16} Z" fill="{fill}"/>{detail}'


def _wide_pants(fill, waist=648, hem=1016):
    return (
        f'<path d="M374 {waist} L354 {hem} L446 {hem} L450 764 L454 {hem} L546 {hem} L526 {waist} Z" fill="{fill}"/>'
        f'<rect x="374" y="{waist - 14}" width="152" height="22" rx="10" fill="{fill}"/>'
    )


def _slacks(fill, crease, waist=648, hem=1012):
    return (
        f'<path d="M382 {waist} L370 {hem} L440 {hem} L450 752 L460 {hem} L530 {hem} L518 {waist} Z" fill="{fill}"/>'
        f'<rect x="382" y="{waist - 14}" width="136" height="22" rx="10" fill="{fill}"/>'
        f'<path d="M404 {waist + 60} L398 {hem - 12}" stroke="{crease}" stroke-width="4" fill="none"/>'
        f'<path d="M496 {waist + 60} L502 {hem - 12}" stroke="{crease}" stroke-width="4" fill="none"/>'
    )


def _shoes(color, sole="#00000022", chunky=False):
    sole_h = 18 if chunky else 10
    return (
        f'<rect x="352" y="1008" width="98" height="36" rx="16" fill="{color}"/>'
        f'<rect x="450" y="1008" width="98" height="36" rx="16" fill="{color}"/>'
        f'<rect x="348" y="1040" width="106" height="{sole_h}" rx="{sole_h // 2}" fill="{sole}"/>'
        f'<rect x="446" y="1040" width="106" height="{sole_h}" rx="{sole_h // 2}" fill="{sole}"/>'
    )


def _sandals(skin, strap):
    return (
        f'<rect x="356" y="1012" width="92" height="30" rx="14" fill="{skin}"/>'
        f'<rect x="452" y="1012" width="92" height="30" rx="14" fill="{skin}"/>'
        f'<path d="M366 1024 L438 1024" stroke="{strap}" stroke-width="8"/>'
        f'<path d="M462 1024 L534 1024" stroke="{strap}" stroke-width="8"/>'
        f'<rect x="352" y="1042" width="100" height="10" rx="5" fill="{strap}"/>'
        f'<rect x="448" y="1042" width="100" height="10" rx="5" fill="{strap}"/>'
    )


def _head(skin, hair_back, hair_front, extra=""):
    """頭。アバターと同じ顔立ち・髪色(座標は頭の中心が原点、半径 76x82)。"""
    return (
        f'<g transform="translate(450 320)">{hair_back}'
        f'<ellipse cx="0" cy="0" rx="76" ry="82" fill="{skin}"/>'
        f"{hair_front}"
        f'<circle cx="-28" cy="12" r="7" fill="#38302a"/><circle cx="28" cy="12" r="7" fill="#38302a"/>'
        f'<circle cx="-46" cy="34" r="11" fill="#ef9f9f" opacity="0.4"/><circle cx="46" cy="34" r="11" fill="#ef9f9f" opacity="0.4"/>'
        f'<path d="M-14 44 Q0 56 14 44" stroke="#b4685f" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
        f"{extra}</g>"
    )


# 頭部の見た目(肌・後ろ髪・前髪・飾り)。AVATARS と同じ人物に見えるよう配色を揃える。
HEADS = {
    "demo_aoi": (
        "#f6d7c0",
        '<path d="M-88 -8 a88 88 0 1 1 176 0 v56 q0 26 -26 26 h-124 q-26 0 -26 -26 z" fill="#4a3628"/>',
        '<path d="M-72 -8 Q-68 -84 0 -86 Q68 -84 72 -8 Q46 -46 0 -46 Q-46 -46 -72 -8 Z" fill="#4a3628"/>',
        "",
    ),
    "demo_rin": (
        "#f2cdb5",
        # 後ろ髪は左右2束に分ける(1枚の面で塗るとブラウスの胸元まで覆ってしまう。
        # 中央の谷は y=60 まで上げてあり、顔(半径82)の裏に隠れる)。
        '<path d="M-80 -20 Q-80 -88 0 -88 Q80 -88 80 -20 L88 170 Q60 152 48 162 L42 60 Q0 84 -42 60 L-48 162 Q-60 152 -88 170 Z" fill="#2c2624"/>',
        '<path d="M-74 -4 Q-74 -84 0 -86 Q74 -84 74 -4 Q62 -50 22 -54 Q8 -34 0 -34 Q-8 -34 -22 -54 Q-62 -50 -74 -4 Z" fill="#2c2624"/>',
        '<circle cx="-74" cy="28" r="5" fill="#d9b64f"/><circle cx="74" cy="28" r="5" fill="#d9b64f"/>',
    ),
    "demo_hinano": (
        "#f8dcc8",
        '<circle cx="-90" cy="-88" r="36" fill="#8a5a3b"/><circle cx="90" cy="-88" r="36" fill="#8a5a3b"/>'
        '<path d="M-84 -4 a84 84 0 1 1 168 0 v50 q0 24 -24 24 h-120 q-24 0 -24 -24 z" fill="#8a5a3b"/>',
        '<path d="M-70 -6 Q-66 -82 0 -84 Q66 -82 70 -6 Q46 -44 0 -42 Q-46 -44 -70 -6 Z" fill="#8a5a3b"/>',
        '<circle cx="-90" cy="-116" r="10" fill="#f2b6c6"/><circle cx="90" cy="-116" r="10" fill="#f2b6c6"/>',
    ),
    "demo_yuto": (
        "#e8c39e",
        '<path d="M-86 4 Q-92 -88 0 -90 Q92 -88 86 4 v22 h-172 z" fill="#26221f"/>',
        '<path d="M-82 8 Q-84 -84 0 -86 Q84 -84 82 8 Q70 -32 0 -34 Q-70 -32 -82 8 Z" fill="#26221f"/>',
        "",
    ),
    "demo_kai": (
        "#f2cdb5",
        '<path d="M-82 0 Q-82 -86 0 -88 Q82 -86 82 0 v18 h-164 z" fill="#3b2f26"/>',
        '<path d="M-76 -2 Q-74 -82 0 -84 Q74 -82 76 -2 Q72 -44 22 -50 L0 -20 L-22 -50 Q-72 -44 -76 -2 Z" fill="#3b2f26"/>',
        "",
    ),
    "demo_sora": (
        "#e0b48f",
        '<circle cx="-58" cy="-58" r="34" fill="#5d4630"/><circle cx="-20" cy="-76" r="36" fill="#5d4630"/>'
        '<circle cx="22" cy="-76" r="36" fill="#5d4630"/><circle cx="58" cy="-56" r="34" fill="#5d4630"/>'
        '<circle cx="-78" cy="-18" r="28" fill="#5d4630"/><circle cx="78" cy="-18" r="28" fill="#5d4630"/>',
        '<path d="M-70 -12 Q-64 -76 0 -78 Q64 -76 70 -12 Q44 -40 0 -40 Q-44 -40 -70 -12 Z" fill="#5d4630"/>',
        "",
    ),
}


def _body_aoi(skin):
    # 白の半袖ニット(裾リブ)× 淡色ワイドデニム × 白スニーカー。裾出し。
    return "".join([
        _neck(skin),
        _arms("#f7f5f1", "short", skin),
        _wide_pants("#b8cfe6"),
        _torso("#f7f5f1", hem=676, detail=(
            '<path d="M384 650 Q450 674 516 650" stroke="#e4ded2" stroke-width="5" fill="none"/>'
            '<path d="M416 470 Q450 488 484 470" stroke="#e4ded2" stroke-width="4" fill="none"/>'
        )),
        _shoes("#ffffff", sole="#d8dde3"),
    ])


def _body_rin(skin):
    # 白フリルブラウス × 黒ワイドスラックス × 黒フラット。タックイン。
    frills = "".join(
        f'<circle cx="450" cy="{y}" r="9" fill="#ffffff" stroke="#00000014"/>' for y in range(496, 640, 28)
    )
    collar = '<path d="M424 452 Q450 478 476 452 L470 444 Q450 462 430 444 Z" fill="#efeae2"/>'
    return "".join([
        _neck(skin),
        _arms("#fbf9f6", "long", skin),
        _torso("#fbf9f6", hem=660, detail=collar + frills),
        _slacks("#33343a", "#4a4b52"),
        _shoes("#26262b"),
    ])


def _body_hinano(skin):
    # 白レースキャミワンピ + 黄の花柄カーデ肩掛け + サンダル。
    chest = f'<path d="M404 438 Q450 468 496 438 L500 474 Q450 498 400 474 Z" fill="{skin}"/>'
    legs = (
        f'<path d="M416 870 L410 1004" stroke="{skin}" stroke-width="30" stroke-linecap="round" fill="none"/>'
        f'<path d="M484 870 L490 1004" stroke="{skin}" stroke-width="30" stroke-linecap="round" fill="none"/>'
    )
    dress = '<path d="M392 470 Q450 492 508 470 L544 884 Q450 916 356 884 Z" fill="#fdfbf8"/>'
    lace = "".join(f'<circle cx="{x}" cy="896" r="13" fill="#fdfbf8"/>' for x in range(368, 536, 24))
    straps = (
        '<path d="M420 478 L426 448" stroke="#fdfbf8" stroke-width="7"/>'
        '<path d="M480 478 L474 448" stroke="#fdfbf8" stroke-width="7"/>'
    )
    flowers = "".join(
        f'<circle cx="{x}" cy="{y}" r="7" fill="#ffffff"/><circle cx="{x}" cy="{y}" r="3" fill="#e88fae"/>'
        for x, y in [(376, 540), (372, 592), (524, 540), (528, 592)]
    )
    cardigan = (
        '<path d="M398 458 Q378 480 374 636" stroke="#f0d264" stroke-width="42" stroke-linecap="round" fill="none"/>'
        '<path d="M502 458 Q522 480 526 636" stroke="#f0d264" stroke-width="42" stroke-linecap="round" fill="none"/>'
        + flowers
    )
    return "".join([
        _neck(skin), chest,
        _arms("", "none", skin),
        legs,
        _sandals(skin, "#b98a68"),
        dress, lace, straps, cardigan,
    ])


def _body_yuto(skin):
    # ネイビーギンガムシャツ × インディゴワイドデニム × 黒厚底ローファー。タックイン。
    collar = '<path d="M426 450 L450 486 L474 450 L492 460 L450 512 L408 460 Z" fill="#2f4468"/>'
    buttons = "".join(f'<circle cx="450" cy="{y}" r="4" fill="#ffffff" opacity="0.85"/>' for y in (526, 566, 606))
    return "".join([
        _neck(skin),
        _arms("url(#gingham)", "long", skin),
        _torso("url(#gingham)", hem=656, detail=collar + buttons),
        _wide_pants("#3a5378"),
        _shoes("#1f1f24", sole="#0d0d10", chunky=True),
    ])


def _body_kai(skin):
    # 黒ニットポロ × グレースラックス × 黒ペニーローファー。裾出し。
    collar = (
        '<path d="M424 448 L450 480 L476 448 L470 440 Q450 454 430 440 Z" fill="#1c1c20"/>'
        '<path d="M450 480 L450 522" stroke="#1c1c20" stroke-width="4"/>'
        '<circle cx="450" cy="496" r="3.5" fill="#5a5a62"/><circle cx="450" cy="512" r="3.5" fill="#5a5a62"/>'
    )
    strap = (
        '<path d="M368 1022 L436 1022" stroke="#3a3436" stroke-width="7"/>'
        '<path d="M464 1022 L532 1022" stroke="#3a3436" stroke-width="7"/>'
    )
    return "".join([
        _neck(skin),
        _arms("#26262a", "short", skin),
        _slacks("#9a9ba3", "#8a8b93"),
        _torso("#26262a", hem=672, detail=collar),
        _shoes("#221f1f"),
        strap,
    ])


def _body_sora(skin):
    # アイボリーシャツ(開襟・裾出し)× 淡色ワイドデニム × ベージュスニーカー。
    collar = (
        f'<path d="M436 452 L450 478 L464 452 Z" fill="{skin}"/>'
        '<path d="M428 450 L450 486 L436 494 Z" fill="#e6dfc9"/>'
        '<path d="M472 450 L450 486 L464 494 Z" fill="#e6dfc9"/>'
        '<path d="M450 494 L450 664" stroke="#e6dfc9" stroke-width="3"/>'
    )
    return "".join([
        _neck(skin),
        _arms("#f2ecdc", "long", skin),
        _wide_pants("#b8cfe6"),
        _torso("#f2ecdc", hem=684, detail=collar),
        _shoes("#efe9dc", sole="#d9d0bc"),
    ])


def wearing_svg(bg, note, defs, body_svg, head_svg, items_line, footer):
    """着用画の台紙。board_svg とトーンを揃えた 900x1200(3:4)。"""
    # アイテムが3点あると1行に収まらないので、長い行は幅820pxに詰めて描く。
    items_fit = ' textLength="820" lengthAdjust="spacingAndGlyphs"' if len(items_line) > 34 else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1200">
<defs>{defs}</defs>
<rect width="900" height="1200" fill="{bg}"/>
<circle cx="70" cy="1130" r="150" fill="#ffffff" opacity="0.35"/>
<circle cx="850" cy="120" r="120" fill="#ffffff" opacity="0.35"/>
<text x="60" y="110" font-size="64" font-weight="bold" letter-spacing="6" fill="#3d3630" font-family="Georgia,'Times New Roman',serif">MC STUDIO</text>
<text x="60" y="152" font-size="26" fill="#6b625a" font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">OFFICIAL SAMPLE ── 着用イメージ({note})</text>
<text x="60" y="190" font-size="22" fill="#8a8178" font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">この人物・ブランドは実在しません(公式サンプルのイラスト)</text>
<g transform="translate(0 26)">
<ellipse cx="450" cy="1052" rx="180" ry="16" fill="#000000" opacity="0.06"/>
{body_svg}
{head_svg}
</g>
<text x="450" y="1122" text-anchor="middle" font-size="24" fill="#6b625a"{items_fit} font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">{items_line}</text>
<text x="450" y="1166" text-anchor="middle" font-size="26" font-weight="bold" fill="#6b625a" font-family="'Hiragino Kaku Gothic ProN','Yu Gothic',sans-serif">{footer}</text>
</svg>"""


# 着用画のアイテムタグ位置(カテゴリー → 画像上の相対座標)。
WEAR_TAG_POS = {
    "tops": (0.5, 0.44),
    "bottoms": (0.5, 0.70),
    "shoes": (0.5, 0.87),
    "onepiece": (0.5, 0.53),
    "outerwear": (0.62, 0.44),
}

# 各人の着用画の中身。items は CATALOG のキー(着ている服=アイテムタグになる)。
WEARING = {
    "demo_aoi": {
        "note": "淡色カジュアル", "body": _body_aoi, "defs": "",
        "items": ["white-knit-tee", "light-denim-w"],
        "caption": "着用イメージ🕊 白ニット×淡色デニム。上をゆるっと、下は落ち感でバランスよく!",
        "tags": ["着用イメージ", "淡色コーデ", "カジュアル", "サンプル投稿"],
        "footer": "あなたの今日のコーデも投稿してみてね",
    },
    "demo_rin": {
        "note": "通勤きれいめ", "body": _body_rin, "defs": "",
        "items": ["frill-blouse", "black-slacks-w"],
        "caption": "フリルブラウス×黒スラックスの着用イメージ。甘さは上半身だけに集めるのがコツです。",
        "tags": ["着用イメージ", "オフィスカジュアル", "きれいめ", "サンプル投稿"],
        "footer": "タグをタップすると服の詳細が見られます",
    },
    "demo_hinano": {
        "note": "甘めガーリー", "body": _body_hinano, "defs": "",
        "items": ["lace-dress", "floral-cardigan"],
        "caption": "レースワンピ+花柄カーデ肩掛けの着用イメージ🎀 足元はサンダルでちょっと外し!",
        "tags": ["着用イメージ", "ガーリー", "ワンピース", "サンプル投稿"],
        "footer": "まねっこ大歓迎!好きな服で試してみてね",
    },
    "demo_yuto": {
        "note": "古着ミックス", "body": _body_yuto,
        "defs": _gingham_defs("gingham", "#f5f7fa", "#34486e"),
        "items": ["navy-gingham", "indigo-denim", "chunky-loafer"],
        "caption": "ギンガム×ワイドデニムの着用イメージ🔥 タックインで重心を上げるとキマる!",
        "tags": ["着用イメージ", "ストリート", "古着ミックス", "サンプル投稿"],
        "footer": "2択に迷ったらみんなに投げてみよう",
    },
    "demo_kai": {
        "note": "大人きれいめ", "body": _body_kai, "defs": "",
        "items": ["knit-polo", "gray-slacks-m", "penny-loafer"],
        "caption": "ニットポロ×グレースラックスの着用イメージ。アイロン不要で「ちゃんと見える」やつです。",
        "tags": ["着用イメージ", "きれいめ", "大人カジュアル", "サンプル投稿"],
        "footer": "服に値段を登録すると「全身でいくら」も出せます",
    },
    "demo_sora": {
        "note": "ナチュラル", "body": _body_sora, "defs": "",
        "items": ["ivory-shirt", "light-denim-m"],
        "caption": "生成りシャツ×淡色デニムの着用イメージ。質感に差があると少ない服でも単調に見えません。",
        "tags": ["着用イメージ", "ナチュラル", "ミニマル", "サンプル投稿"],
        "footer": "クローゼットに服を入れるところから始めよう",
    },
}


# ---------------------------------------------------------------- data

# (rel_path, label, category, hashtags, price, color, size)
CATALOG = {
    "white-knit-tee": ("women/white-knit-tee.png", "白の半袖ニット", "tops", ["白トップス", "ニット", "シンプル", "定番"], 2990, "白", "F"),
    "sax-shirt": ("women/sax-blue-oversized-shirt.png", "サックスブルーのオーバーシャツ", "tops", ["オーバーサイズシャツ", "サックスブルー", "抜け感", "韓国系"], 4990, "サックス", "F"),
    "light-denim-w": ("women/light-blue-wide-denim.png", "淡色のワイドデニム", "bottoms", ["デニム", "ワイドパンツ", "淡色", "カジュアル"], 5990, "淡色", "M"),
    "cargo-shorts": ("women/denim-cargo-shorts.png", "デニムのカーゴショーツ", "bottoms", ["ショートパンツ", "カーゴ", "デニム", "夏コーデ"], 4590, "デニム", "M"),
    "frill-blouse": ("women/white-frill-blouse.png", "白のフリルブラウス", "tops", ["ブラウス", "フリル", "白", "きれいめ"], 5990, "白", "M"),
    "charcoal-tee": ("women/charcoal-long-tee.png", "チャコールの長袖カットソー", "tops", ["カットソー", "長袖", "グレー", "シンプル"], 3490, "チャコール", "M"),
    "gray-slacks-w": ("women/gray-wide-slacks.png", "グレーのワイドスラックス", "bottoms", ["スラックス", "ワイドパンツ", "グレー", "きれいめ"], 6490, "グレー", "M"),
    "black-slacks-w": ("women/black-wide-slacks.png", "黒のワイドスラックス", "bottoms", ["スラックス", "ワイドパンツ", "黒", "きれいめ"], 6490, "黒", "M"),
    "gingham-blouse": ("women/red-gingham-puff-blouse.png", "赤ギンガムのパフスリーブ", "tops", ["ブラウス", "ギンガムチェック", "パフスリーブ", "ガーリー"], 4290, "赤", "S"),
    "tiered-cami": ("women/ivory-tiered-camisole.png", "生成りのティアードキャミ", "tops", ["キャミソール", "ティアード", "生成り", "ガーリー"], 3990, "生成り", "S"),
    "lace-dress": ("women/white-lace-camisole-dress.png", "白のレースキャミワンピース", "onepiece", ["ワンピース", "レース", "白", "ガーリー", "夏コーデ"], 7990, "白", "S"),
    "floral-cardigan": ("women/yellow-floral-cardigan.png", "イエローの花柄カーディガン", "outerwear", ["カーディガン", "花柄", "イエロー", "ガーリー"], 5490, "イエロー", "F"),
    "navy-gingham": ("men/navy-gingham-shirt.png", "ネイビーギンガムシャツ", "tops", ["チェックシャツ", "ギンガム", "ネイビー", "カジュアル"], 4490, "ネイビー", "L"),
    "navy-check-ss": ("men/navy-check-short-shirt.png", "ネイビーチェックの半袖シャツ", "tops", ["半袖シャツ", "チェック", "夏コーデ", "カジュアル"], 3990, "ネイビー", "L"),
    "indigo-denim": ("men/indigo-wide-denim.png", "インディゴのワイドデニム", "bottoms", ["デニム", "ワイドパンツ", "インディゴ", "ストリート"], 6990, "インディゴ", "L"),
    "chunky-loafer": ("men/black-chunky-loafer.png", "黒の厚底ローファー", "shoes", ["ローファー", "厚底", "黒", "モード"], 8990, "黒", "27"),
    "white-shirt-m": ("men/white-shirt.png", "白シャツ", "tops", ["白シャツ", "シャツ", "きれいめ", "定番"], 5490, "白", "L"),
    "knit-polo": ("men/black-knit-polo.png", "黒のニットポロ", "tops", ["ニットポロ", "黒", "きれいめ", "大人カジュアル"], 6490, "黒", "L"),
    "gray-slacks-m": ("men/gray-slacks.png", "グレーのスラックス", "bottoms", ["スラックス", "グレー", "きれいめ", "オフィスカジュアル"], 7490, "グレー", "L"),
    "penny-loafer": ("men/black-penny-loafer.png", "黒のペニーローファー", "shoes", ["ローファー", "黒", "きれいめ", "革靴"], 9990, "黒", "27"),
    "ivory-shirt": ("men/ivory-shirt.png", "アイボリーシャツ", "tops", ["シャツ", "生成り", "ナチュラル", "きれいめ"], 5990, "生成り", "L"),
    "gray-polo": ("men/gray-polo-shirt.png", "グレーのポロシャツ", "tops", ["ポロシャツ", "グレー", "きれいめ", "夏コーデ"], 4490, "グレー", "L"),
    "light-denim-m": ("men/light-blue-wide-denim.png", "淡色のワイドデニム", "bottoms", ["デニム", "ワイドパンツ", "淡色", "カジュアル"], 6590, "淡色", "L"),
    "black-long-shirt": ("men/black-long-shirt.png", "黒の長袖シャツ", "tops", ["黒シャツ", "シャツ", "モード", "大人カジュアル"], 5990, "黒", "L"),
}

PERSONAS = [
    {
        "uid": "demo_aoi", "name": "あおい(公式サンプル)", "handle": "aoi_mc",
        "bio": f"20歳・大学2年。淡色とデニムがすき🕊 朝は結局いつも2択で迷ってる\n{DISCLAIMER}",
        "wardrobe": "women", "height": 158, "bodyType": "wave", "personalColor": "summer",
        "personalColorSub": "spring",
        "genres": ["casual", "korean"],
        "items": ["white-knit-tee", "sax-shirt", "light-denim-w", "cargo-shorts"],
        "favorites": ["white-knit-tee"],
        "board": {"bg": "#e3edf7", "accent": "#5b87b5", "note": "淡色カジュアル",
                  "items": ["white-knit-tee", "light-denim-w"],
                  "caption": f"今日は白ニット×淡色デニムのゆるコーデ🕊 迷ったら全身どこか1ヶ所に色を足すのがマイルール!\n{DISCLAIMER}",
                  "tags": ["淡色コーデ", "カジュアル", "デニム", "サンプル投稿"], "season": "summer",
                  "footer": "あなたも今日のコーデ、2択にして聞いてみてね"},
        "outfit": {"a": ["white-knit-tee", "light-denim-w"], "b": ["sax-shirt", "cargo-shorts"],
                   "mood": "午後から大学!歩きやすさ重視だけど可愛くいたい🥐 AとB、どっちがいい?",
                   "note": f"{DISCLAIMER} 気軽に投票してみてください!"},
    },
    {
        "uid": "demo_rin", "name": "りん(公式サンプル)", "handle": "rin_mc",
        "bio": f"24歳・会社員2年目。きれいめ×ラクちんを研究中。ヒールは履かない派\n{DISCLAIMER}",
        "wardrobe": "women", "height": 162, "bodyType": "straight", "personalColor": "winter",
        "genres": ["kirei", "classic"],
        "items": ["frill-blouse", "charcoal-tee", "gray-slacks-w", "black-slacks-w"],
        "favorites": ["black-slacks-w"],
        "board": {"bg": "#f2e8e6", "accent": "#a4766e", "note": "通勤きれいめ",
                  "items": ["frill-blouse", "black-slacks-w"],
                  "caption": f"プレゼンの日はこの組み合わせ。フリルは甘いけど黒スラックスで引き締めると仕事でも浮きません!\n{DISCLAIMER}",
                  "tags": ["オフィスカジュアル", "きれいめ", "通勤コーデ", "サンプル投稿"], "season": "summer",
                  "footer": "服に値段を登録すると「全身でいくら」も見せられます"},
        "outfit": {"a": ["frill-blouse", "black-slacks-w"], "b": ["charcoal-tee", "gray-slacks-w"],
                   "mood": "今日はプレゼン。きちんと見えつつ盛れるのはどっち?",
                   "note": f"{DISCLAIMER}"},
    },
    {
        "uid": "demo_hinano", "name": "ひなの(公式サンプル)", "handle": "hinano_mc",
        "bio": f"18歳・専門1年🎀 甘めとY2Kを行ったり来たり。プリと古着屋めぐりが生きがい\n{DISCLAIMER}",
        "wardrobe": "women", "height": 153, "bodyType": "wave", "personalColor": "spring",
        "genres": ["girly", "y2k"],
        "items": ["gingham-blouse", "tiered-cami", "lace-dress", "floral-cardigan", "cargo-shorts"],
        "favorites": ["lace-dress", "gingham-blouse"],
        "board": {"bg": "#fbe9ef", "accent": "#cd7d96", "note": "甘めガーリー",
                  "items": ["lace-dress", "floral-cardigan", "tiered-cami"],
                  "caption": f"レースワンピに花柄カーデを肩掛けするのが最近のお気に入り🎀 甘×甘は小物で外すのがコツ!\n{DISCLAIMER}",
                  "tags": ["ガーリー", "ワンピース", "甘めコーデ", "サンプル投稿"], "season": "summer",
                  "footer": "初投稿はまねっこでOK!好きな服を並べてみよう"},
        "outfit": {"a": ["lace-dress", "floral-cardigan"], "b": ["gingham-blouse", "cargo-shorts"],
                   "mood": "放課後プリ撮りにいく🎀 Aワンピで甘めか、Bギンガムでカジュアルか!",
                   "note": f"{DISCLAIMER}"},
    },
    {
        "uid": "demo_yuto", "name": "ゆうと(公式サンプル)", "handle": "yuto_mc",
        "bio": f"21歳・大学3年。古着とスニーカー、たまにライブ🔥 ワイドパンツしか勝たん\n{DISCLAIMER}",
        "wardrobe": "men", "height": 172, "bodyType": "natural", "personalColor": "autumn",
        "genres": ["street", "casual"],
        "items": ["navy-gingham", "navy-check-ss", "indigo-denim", "chunky-loafer"],
        "favorites": ["indigo-denim"],
        "board": {"bg": "#e6ede4", "accent": "#5e7d5a", "note": "古着ミックス",
                  "items": ["navy-gingham", "indigo-denim", "chunky-loafer"],
                  "caption": f"ギンガム×ワイドデニム×厚底ローファー。上をタックインすると重心が上がってバランス取れる🔥\n{DISCLAIMER}",
                  "tags": ["ストリート", "古着ミックス", "ワイドパンツ", "サンプル投稿"], "season": "summer",
                  "footer": "タグをタップするとブランドと値段が見られます"},
        "outfit": {"a": ["navy-gingham", "indigo-denim", "chunky-loafer"],
                   "b": ["navy-check-ss", "indigo-denim", "chunky-loafer"],
                   "mood": "今日はライブ🔥 動きやすいのはBだけど、Aの方がキマる気もする。どっち?",
                   "note": f"{DISCLAIMER}"},
    },
    {
        "uid": "demo_kai", "name": "かい(公式サンプル)", "handle": "kai_mc",
        "bio": f"26歳・営業。平日はシャツ、休日もだいたいシャツ。革靴を育てるのが趣味\n{DISCLAIMER}",
        "wardrobe": "men", "height": 178, "bodyType": "straight", "personalColor": "winter",
        "personalColorSub": "summer",
        "genres": ["kirei", "classic"],
        "items": ["white-shirt-m", "knit-polo", "gray-slacks-m", "penny-loafer"],
        "favorites": ["penny-loafer"],
        "board": {"bg": "#e9e8f2", "accent": "#6f6da8", "note": "大人きれいめ",
                  "items": ["knit-polo", "gray-slacks-m", "penny-loafer"],
                  "caption": f"ニットポロ×スラックス×ローファー。アイロン不要で「ちゃんとして見える」最強の3点です。\n{DISCLAIMER}",
                  "tags": ["きれいめ", "大人カジュアル", "ローファー", "サンプル投稿"], "season": "summer",
                  "footer": "2択に迷ったら友達に投げよう。投票はワンタップ"},
        "outfit": {"a": ["white-shirt-m", "gray-slacks-m", "penny-loafer"],
                   "b": ["knit-polo", "gray-slacks-m", "penny-loafer"],
                   "mood": "仕事終わりにデート。爽やかAか、大人Bか…助けてください!",
                   "note": f"{DISCLAIMER}"},
    },
    {
        "uid": "demo_sora", "name": "そら(公式サンプル)", "handle": "sora_mc",
        "bio": f"28歳・カメラマン。生成りとベージュに弱い。持たない暮らしを目指して服は少数精鋭\n{DISCLAIMER}",
        "wardrobe": "men", "height": 175, "bodyType": "natural", "personalColor": "autumn",
        "genres": ["natural"],
        "items": ["ivory-shirt", "gray-polo", "light-denim-m", "black-long-shirt"],
        "favorites": ["ivory-shirt"],
        "board": {"bg": "#f1ebdd", "accent": "#a08a5f", "note": "ナチュラル",
                  "items": ["ivory-shirt", "light-denim-m"],
                  "caption": f"生成りシャツ×淡色デニム。少ない服でも「質感の差」があると単調に見えません。\n{DISCLAIMER}",
                  "tags": ["ナチュラル", "生成り", "ミニマル", "サンプル投稿"], "season": "summer",
                  "footer": "クローゼットに服を入れるところから始めよう"},
        "outfit": {"a": ["ivory-shirt", "light-denim-m"], "b": ["gray-polo", "light-denim-m"],
                   "mood": "休日、カメラ持って散歩する日。ラフすぎないのはどっちだろう?",
                   "note": f"{DISCLAIMER}"},
    },
]

# 置き画ボードのカードレイアウト(点数別)。(x, y, w, h, rot)
LAYOUTS = {
    2: [(55, 270, 380, 700, -2.5), (465, 330, 380, 700, 2.5)],
    3: [(70, 250, 340, 500, -3), (490, 285, 340, 500, 2.5), (280, 640, 340, 500, -1.5)],
}

VOTE_PLAN = {
    # postオーナー: [(投票者, 候補, 理由)]
    "demo_aoi": [("demo_hinano", 0, "vibe"), ("demo_rin", 0, "color"), ("demo_yuto", 1, "season")],
    "demo_rin": [("demo_kai", 0, "plan"), ("demo_aoi", 0, "color")],
    "demo_hinano": [("demo_aoi", 0, "vibe"), ("demo_rin", 1, "season"), ("demo_sora", 0, "color")],
    "demo_yuto": [("demo_sora", 1, "season"), ("demo_kai", 0, "vibe")],
    "demo_kai": [("demo_rin", 1, "plan"), ("demo_yuto", 1, "vibe"), ("demo_hinano", 0, "color")],
    "demo_sora": [("demo_kai", 0, "vibe"), ("demo_aoi", 0, "color")],
}

OUTFIT_COMMENTS = {
    "demo_aoi": ("demo_rin", "Aの淡色合わせ、清潔感あってすき!"),
    "demo_rin": ("demo_aoi", "プレゼンならAが説得力ある気がします💪"),
    "demo_hinano": ("demo_aoi", "Bのギンガム、写真映えしそう!"),
    "demo_yuto": ("demo_kai", "ライブなら半袖のBが正解だと思う"),
    "demo_kai": ("demo_rin", "デートはBのニットポロに1票…!"),
    "demo_sora": ("demo_yuto", "散歩ならA。シャツの抜け感がいい"),
}

STYLE_COMMENTS = {
    "demo_aoi": ("demo_hinano", "淡色×白、まねしたい🥺"),
    "demo_rin": ("demo_kai", "フリル×黒の引き締め、勉強になります"),
    "demo_hinano": ("demo_rin", "肩掛けカーデ可愛い!"),
    "demo_yuto": ("demo_sora", "タックインのバランス感すごい"),
    "demo_kai": ("demo_yuto", "この3点セット、間違いないですね"),
    "demo_sora": ("demo_aoi", "質感で差をつけるの、なるほどです…!"),
}

STYLE_LIKES = {
    "demo_aoi": ["demo_rin", "demo_hinano", "demo_sora"],
    "demo_rin": ["demo_kai", "demo_aoi"],
    "demo_hinano": ["demo_aoi", "demo_rin", "demo_yuto"],
    "demo_yuto": ["demo_sora", "demo_hinano"],
    "demo_kai": ["demo_rin", "demo_yuto", "demo_sora"],
    "demo_sora": ["demo_aoi", "demo_kai"],
}


def item_id(uid: str, key: str) -> str:
    return f"demo_item_{uid.removeprefix('demo_')}_{key}"


def main():
    all_uids = [p["uid"] for p in PERSONAS]

    for idx, p in enumerate(PERSONAS):
        uid = p["uid"]
        print(f"== {uid} ==")

        # 1) アバター
        avatar_url = upload_public(f"demo/avatars/{uid}.svg", AVATARS[uid].encode("utf-8"), "image/svg+xml")

        # 2) ユーザー本体(official は運営付与の認証バッジ)
        set_doc(f"users/{uid}", {
            "uid": uid,
            "name": p["name"],
            "avatarUrl": avatar_url,
            "inviteCode": f"DEMO{idx:02d}X{uid[-3:].upper()}",
            "friendUids": [u for u in all_uids if u != uid],
            "createdAt": NOW - 3 * DAY - idx * HOUR,
            "handle": p["handle"],
            "bio": p["bio"],
            "height": p["height"],
            "bodyType": p["bodyType"],
            "personalColor": p["personalColor"],
            "personalColorSub": p.get("personalColorSub", "unknown"),
            "favoriteGenres": p["genres"],
            "followerCount": len(all_uids) - 1,
            "followingCount": len(all_uids) - 1,
            "postCount": 2,  # 置き画ボード + 着用画
            "primaryWardrobe": p["wardrobe"],
            "official": True,
        })

        # 3) クローゼット(値段は公開=値段機能のお手本)
        for n, key in enumerate(p["items"]):
            rel, label, category, hashtags, price, color, size = CATALOG[key]
            set_doc(f"closetItems/{item_id(uid, key)}", {
                "id": item_id(uid, key),
                "ownerUid": uid,
                "category": category,
                "label": label,
                "imageUrl": f"/seed/{rel}",
                "isSeed": False,
                "createdAt": NOW - 2 * DAY - n * HOUR,
                "brand": "MC STUDIO",
                "size": size,
                "color": color,
                "genres": p["genres"],
                "seasons": ["summer"],
                "memo": "公式サンプル(架空ブランド)",
                "wearCount": (idx + n) % 5,
                "lastWornAt": None,
                "wardrobe": p["wardrobe"],
                "hashtags": hashtags,
                "price": price,
                "pricePublic": True,
                "favorite": key in p["favorites"],
            })

        # 4) 置き画ボード → stylePost
        b = p["board"]
        layout = LAYOUTS[len(b["items"])]
        board_items, tags = [], []
        for (key, (x, y, w, h, rot)) in zip(b["items"], layout):
            rel, label, category, hashtags, price, _, _ = CATALOG[key]
            b64, size_px = seed_png_b64(rel)
            board_items.append((b64, size_px, label, price, x, y, w, h, rot))
            tags.append({
                "itemId": item_id(uid, key),
                "label": label,
                "brand": "MC STUDIO",
                "category": category,
                "x": round((x + w / 2) / 900, 3),
                "y": round((y + h * 0.42) / 1200, 3),
            })
        svg = board_svg(b["bg"], b["accent"], b["note"], board_items, b["footer"])
        image_url = upload_public(f"demo/styles/{uid}_look1.svg", svg.encode("utf-8"), "image/svg+xml")

        style_id = f"demo_style_{uid.removeprefix('demo_')}_1"
        item_hashtags = [t for key in b["items"] for t in CATALOG[key][3]]
        set_doc(f"stylePosts/{style_id}", {
            "id": style_id,
            "ownerUid": uid,
            "ownerName": p["name"],
            "ownerAvatarUrl": avatar_url,
            "ownerHandle": p["handle"],
            "imageUrl": image_url,
            "caption": b["caption"],
            "itemTags": tags,
            "genres": p["genres"],
            "season": b["season"],
            "visibility": "public",
            "likeCount": len(STYLE_LIKES[uid]),
            "commentCount": 1,
            "createdAt": NOW - (20 - idx * 3) * HOUR,
            "outfitPostId": None,
            "placeName": None,
            "hashtags": list(dict.fromkeys(item_hashtags + b["tags"]))[:20],
        })
        for liker in STYLE_LIKES[uid]:
            set_doc(f"stylePosts/{style_id}/likes/{liker}", {
                "id": liker, "postId": style_id, "uid": liker,
                "createdAt": NOW - (18 - idx * 2) * HOUR,
            })
        c_uid, c_text = STYLE_COMMENTS[uid]
        c_p = next(x for x in PERSONAS if x["uid"] == c_uid)
        set_doc(f"stylePosts/{style_id}/comments/demo_comment_{style_id}", {
            "id": f"demo_comment_{style_id}", "postId": style_id, "uid": c_uid,
            "name": c_p["name"],
            "avatarUrl": f"https://storage.googleapis.com/{BUCKET}/demo/avatars/{c_uid}.svg",
            "text": c_text, "createdAt": NOW - (16 - idx * 2) * HOUR,
        })

        # 4.6) 着用画(本人が着ている姿のイラスト)→ stylePost 2本目(Kazさん依頼 2026-08-04)
        w = WEARING[uid]
        skin, hair_back, hair_front, head_extra = HEADS[uid]
        wear_items_line = " / ".join(
            f"{CATALOG[k][1]} ¥{CATALOG[k][4]:,}" for k in w["items"]
        )
        wear_svg = wearing_svg(
            p["board"]["bg"], w["note"], w["defs"], w["body"](skin),
            _head(skin, hair_back, hair_front, head_extra),
            f"着ているのは:{wear_items_line}", w["footer"],
        )
        wear_url = upload_public(f"demo/styles/{uid}_wear1.svg", wear_svg.encode("utf-8"), "image/svg+xml")

        wear_id = f"demo_style_{uid.removeprefix('demo_')}_wear"
        wear_tags = []
        for k in w["items"]:
            _, label, category, _, _, _, _ = CATALOG[k]
            tx, ty = WEAR_TAG_POS.get(category, (0.5, 0.5))
            wear_tags.append({
                "itemId": item_id(uid, k),
                "label": label,
                "brand": "MC STUDIO",
                "category": category,
                "x": tx,
                "y": ty,
            })
        wear_likers = STYLE_LIKES[uid][:2]
        wear_hashtags = [t for key in w["items"] for t in CATALOG[key][3]]
        set_doc(f"stylePosts/{wear_id}", {
            "id": wear_id,
            "ownerUid": uid,
            "ownerName": p["name"],
            "ownerAvatarUrl": avatar_url,
            "ownerHandle": p["handle"],
            "imageUrl": wear_url,
            "caption": f"{w['caption']}\n※イラストは公式サンプルの着用イメージです。\n{DISCLAIMER}",
            "itemTags": wear_tags,
            "genres": p["genres"],
            "season": "summer",
            "visibility": "public",
            "likeCount": len(wear_likers),
            "commentCount": 0,
            "createdAt": NOW - (9 - idx) * HOUR,
            "outfitPostId": None,
            "placeName": None,
            "hashtags": list(dict.fromkeys(wear_hashtags + w["tags"]))[:20],
        })
        for liker in wear_likers:
            set_doc(f"stylePosts/{wear_id}/likes/{liker}", {
                "id": liker, "postId": wear_id, "uid": liker,
                "createdAt": NOW - (8 - idx) * HOUR,
            })

        # 5) 2択(公開。composeStatus=failed でボード表示に落とす)
        #    期限は 30 日。以前は本物の2択と同じ3日にしていたが、公式サンプルは
        #    「まだ誰もフォローしていない人に見せるプレビュー」なので、数日で
        #    空になると初見の画面が寂しくなる(2026-08-05 にKazさん指示のプレビュー
        #    導線を入れたのに合わせて延ばした)。賑わいを保つための再投入は
        #    引き続き有効(createdAt が実行時刻に更新される)。
        o = p["outfit"]
        outfit_id = f"demo_outfit_{uid.removeprefix('demo_')}_1"
        created = NOW - (2 + idx) * HOUR
        set_doc(f"outfitPosts/{outfit_id}", {
            "id": outfit_id,
            "ownerUid": uid,
            "mood": o["mood"],
            "note": o["note"],
            "candidates": [
                {"itemIds": [item_id(uid, k) for k in o["a"]], "facePatternId": None,
                 "liveCaptureUrl": None, "composedImageUrl": None, "composeStatus": "failed"},
                {"itemIds": [item_id(uid, k) for k in o["b"]], "facePatternId": None,
                 "liveCaptureUrl": None, "composedImageUrl": None, "composeStatus": "failed"},
            ],
            "sharedWithUids": [u for u in all_uids if u != uid],
            "createdAt": created,
            "expiresAt": created + 30 * DAY,
            "decidedCandidateIndex": None,
            "buildMode": "topDown",
            "deletedAt": None,
            "visibility": "public",
        })
        for voter, cand, reason in VOTE_PLAN[uid]:
            set_doc(f"outfitPosts/{outfit_id}/votes/{voter}", {
                "id": voter, "postId": outfit_id, "candidateIndex": cand,
                "voterUid": voter, "createdAt": created + HOUR, "reason": reason,
            })
        oc_uid, oc_text = OUTFIT_COMMENTS[uid]
        oc_p = next(x for x in PERSONAS if x["uid"] == oc_uid)
        set_doc(f"outfitPosts/{outfit_id}/comments/demo_comment_{outfit_id}", {
            "id": f"demo_comment_{outfit_id}", "postId": outfit_id, "uid": oc_uid,
            "name": oc_p["name"],
            "avatarUrl": f"https://storage.googleapis.com/{BUCKET}/demo/avatars/{oc_uid}.svg",
            "text": oc_text, "createdAt": created + int(1.5 * HOUR),
        })

    # 6) フォロー関係(6人が相互フォロー)
    print("== follows ==")
    for a in all_uids:
        for b_ in all_uids:
            if a == b_:
                continue
            set_doc(f"follows/{a}__{b_}", {
                "id": f"{a}__{b_}", "followerUid": a, "followingUid": b_,
                "createdAt": NOW - 3 * DAY,
            })

    print("done. 6 users / closet / style posts / outfit posts / votes / comments / likes / follows")


if __name__ == "__main__":
    main()
