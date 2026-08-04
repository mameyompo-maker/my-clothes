# -*- coding: utf-8 -*-
"""Storage 上の既存画像に Cache-Control を後付けする。

なぜ必要か
----------
Firebase Storage は cacheControl を指定せずに上げたオブジェクトを
``Cache-Control: private, max-age=0`` で配信する。つまりブラウザが一切キャッシュせず、
**画面を移動して戻るたび・スクロールで戻るたびに同じ写真を丸ごと再ダウンロードする**。
クローゼットのように26枚並ぶ画面では、開くたびに数MBを取り直していた。

アプリ側(`src/lib/firestore.ts` の `uploadImage`)は 2026-08-05 から
``public, max-age=31536000, immutable`` を付けて上げるようになったが、**それ以前に
上げたファイルは古いまま**なので、これで一度だけ塗り直す。

このアプリが上げるファイル名は UUID か固定IDで、同じパスの中身が後から変わることは
ない(アイコンを変えても新しいUUIDになる)ので immutable として安全。
ただし公式サンプルの demo/ 配下だけは再投入で中身が変わりうるので短めにする。

使い方(読み書きするのはメタデータだけ。ファイルの中身は触らない):
    $env:GTOKEN = (gcloud auth print-access-token)
    python scripts/backfill_cache_control.py            # 変更内容を表示するだけ
    python scripts/backfill_cache_control.py --apply    # 実際に書き込む
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

BUCKET = "my-clothes-46c81.firebasestorage.app"
TOKEN = os.environ.get("GTOKEN", "")

IMMUTABLE = "public, max-age=31536000, immutable"
DEMO = "public, max-age=3600"

APPLY = "--apply" in sys.argv


def request(url: str, data: bytes | None = None, method: str = "GET"):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {TOKEN}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"{method} {url} -> {e.code}: {body[:300]}") from e


def list_objects():
    """バケット内の全オブジェクト。ページングを最後まで辿る。"""
    token = None
    while True:
        url = f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o?maxResults=1000"
        if token:
            url += f"&pageToken={token}"
        page = request(url)
        for item in page.get("items", []):
            yield item
        token = page.get("nextPageToken")
        if not token:
            break


def main() -> None:
    if not TOKEN:
        raise SystemExit("GTOKEN が未設定です。$env:GTOKEN = (gcloud auth print-access-token)")

    changed = skipped = 0
    for obj in list_objects():
        name = obj["name"]
        want = DEMO if name.startswith("demo/") else IMMUTABLE
        current = obj.get("cacheControl")
        if current == want:
            skipped += 1
            continue
        size_kb = int(obj.get("size", 0)) / 1024
        print(f"  {name}  ({size_kb:.0f}KB)  {current or '(未設定)'} -> {want}")
        if APPLY:
            quoted = urllib.parse.quote(name, safe="")
            request(
                f"https://storage.googleapis.com/storage/v1/b/{BUCKET}/o/{quoted}",
                json.dumps({"cacheControl": want}).encode("utf-8"),
                "PATCH",
            )
        changed += 1

    mode = "更新しました" if APPLY else "更新が必要です(--apply で実行)"
    print(f"\n{changed} 件 {mode} / {skipped} 件は既に設定済み")


if __name__ == "__main__":
    main()
