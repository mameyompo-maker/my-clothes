/**
 * アップロード前にブラウザ側でリサイズ・再圧縮する。Storageの利用量(=課金対象)を
 * 抑えるための処理で、スマホカメラの数MBの写真を数百KB程度に落とす。
 */
export async function compressImage(file: File, maxDimension = 1280, quality = 0.82): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    return blob ?? file;
  } catch {
    // 圧縮に失敗しても投稿自体は止めず、元のファイルをそのままアップロードする。
    return file;
  }
}
