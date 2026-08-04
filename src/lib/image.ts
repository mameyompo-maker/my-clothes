/**
 * アップロード前にブラウザ側でリサイズ・再圧縮する。Storageの利用量(=課金対象)を
 * 抑えるための処理で、スマホカメラの数MBの写真を数百KB程度に落とす。
 */
export async function compressImage(file: File, maxDimension = 1280, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const blob = await renderToJpeg(bitmap, maxDimension, quality);
    bitmap.close?.();
    return blob ?? file;
  } catch {
    // 圧縮に失敗しても投稿自体は止めず、元のファイルをそのままアップロードする。
    return file;
  }
}

/**
 * 投稿用の「本体 + 一覧用サムネイル」を1回のデコードで両方作る。
 *
 * スマホの十数メガピクセルの写真は、デコードだけで1〜2秒かかることがある。
 * 本体とサムネで2回デコードすると単純に倍かかるので、`ImageBitmap` を1つ作って
 * 2回描き分ける。**呼ぶのは写真を選んだ瞬間**で、本人がキャプションを書いている
 * 間に終わらせておく——「投稿する」を押してから圧縮を始めると、その待ち時間が
 * まるごと体感速度になる(Kazさんの「投稿に時間がかかる」への対応)。
 */
export interface PreparedUpload {
  full: Blob;
  thumb: Blob | null;
}

export async function prepareUpload(file: File): Promise<PreparedUpload> {
  try {
    const bitmap = await createImageBitmap(file);
    const [full, thumb] = await Promise.all([
      renderToJpeg(bitmap, 1280, 0.82),
      renderToJpeg(bitmap, 480, 0.7),
    ]);
    bitmap.close?.();
    return { full: full ?? file, thumb };
  } catch {
    return { full: file, thumb: null };
  }
}

async function renderToJpeg(
  bitmap: ImageBitmap,
  maxDimension: number,
  quality: number
): Promise<Blob | null> {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}
