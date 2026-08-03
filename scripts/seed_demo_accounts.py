# -*- coding: utf-8 -*-
"""公式サンプルアカウント(デモユーザー)の投入スクリプト。

ユーザーがゼロの期間でもアプリが寂しくならないよう、架空の6人
(女性3・男性3、10代後半〜20代後半、系統バラバラ)を作り、
2択・全身コーデ投稿(置き画ボード)・投票・理由スタンプ・コメント・いいねを
まとめて Firestore に書き込む。Kazさん依頼(2026-08-04)。

方針:
- 人物写真は一切使わない。アバターはフラットイラスト(SVG)、投稿は服の
  「置き画ボード」。架空であることが視覚的にも伝わるようにする。
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
    """Storage へ公開オブジェクトとしてアップロードし、公開URLを返す。"""
    name = urllib.request.quote(path, safe="")
    url = (
        f"https://storage.googleapis.com/upload/storage/v1/b/{BUCKET}/o"
        f"?uploadType=media&name={name}&predefinedAcl=publicRead"
    )
    _request(url, data, "POST", content_type)
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
            "favoriteGenres": p["genres"],
            "followerCount": len(all_uids) - 1,
            "followingCount": len(all_uids) - 1,
            "postCount": 1,
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

        # 5) 2択(公開・期限3日。composeStatus=failed でボード表示に落とす)
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
            "expiresAt": created + 3 * DAY,
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
