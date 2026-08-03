/**
 * 共有・保存まわり。
 *
 * 端末によってできることが違うので、**必ず段階的に落とす**作りにしている。
 * 「共有できませんでした」で終わらせず、最後はリンクのコピーまで必ず届かせる。
 */

/** 投稿の公開URL。共有もリンクのコピーもここを通す。 */
export function postUrl(postId: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/post/${postId}`;
}

export type ShareResult = "shared" | "copied" | "failed";

/**
 * 投稿を共有する。
 * 1. OS の共有シート(LINEやXに直接送れる)
 * 2. 使えなければクリップボードにコピー
 */
export async function sharePost(postId: string, text: string): Promise<ShareResult> {
  const url = postUrl(postId);
  if (typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ title: "My Clothes", text, url });
      return "shared";
    } catch (err) {
      // ユーザーが共有シートを閉じただけの場合は失敗扱いにしない。
      if (err instanceof DOMException && err.name === "AbortError") return "shared";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

/**
 * 写真を端末に保存する。
 *
 * 画像は Firebase Storage にあり別オリジンなので、`<a download>` だけでは
 * 保存にならず画面遷移してしまう(ブラウザは別オリジンの download 属性を無視する)。
 * そこで **fetch して Blob にしてから同一オリジンの Object URL を作る**。
 * Storage 側の CORS が未設定だと fetch が失敗するので、その場合は
 * 新しいタブで開いて「長押しで保存」に委ねる。iOS Safari はこれが確実。
 */
export async function saveImage(imageUrl: string, filename: string): Promise<"saved" | "opened"> {
  try {
    const res = await fetch(imageUrl, { mode: "cors" });
    if (!res.ok) throw new Error("failed");
    const blob = await res.blob();

    // 共有シートに画像そのものを渡せる端末なら、そちらのほうが保存先を選べて親切。
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return "saved";
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return "saved";
      }
    }

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 即座に revoke するとダウンロードが始まらない端末があるので少し待つ。
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    return "saved";
  } catch {
    window.open(imageUrl, "_blank", "noopener,noreferrer");
    return "opened";
  }
}

/** 任意のデータを JSON ファイルとして保存する。クローゼットの書き出しに使う。 */
export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
