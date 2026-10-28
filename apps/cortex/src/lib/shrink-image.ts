/**
 * Shrink an image in the browser before upload: fit it inside `maxSide` px and
 * re-encode it as JPEG in a canvas. Null when the browser cannot decode the file
 * (e.g. an unsupported format). Client-only — it needs `document`.
 *
 * (The profile-photo picker in the stage-1b PR carries its own copy; fold it onto
 * this one once both are merged.)
 */
export async function shrinkImage(file: File, maxSide: number): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.85));
}
