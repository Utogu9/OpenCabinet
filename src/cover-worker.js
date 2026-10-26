// Decode and shrink originals away from the UI thread. Transfer only the small,
// decoded bitmap; its owner must call close() when it leaves the RAM cache.
if (typeof importScripts === "function") importScripts("locales/catalogs.js", "i18n.js");
const jobs = new Map();
self.onmessage = async ({ data }) => {
  if (data.locale) globalThis.OpenCabinetI18n.setLocale(data.locale);
  if (data.cancel !== undefined) { jobs.get(data.cancel)?.abort(); return; }
  const { id, url } = data;
  const controller = new AbortController();
  jobs.set(id, controller);
  let original = null;
  let thumbnail = null;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const sourceBlob = await response.blob();
    original = await createImageBitmap(sourceBlob);
    const scale = Math.min(1, (data.fullCover ? 1280 : 320) / original.width, (data.fullCover ? 800 : 400) / original.height);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(original.width * scale)), Math.max(1, Math.round(original.height * scale)));
    canvas.getContext("2d").drawImage(original, 0, 0, canvas.width, canvas.height);
    const blob = data.encode || data.fullCover ? (data.fullCover && !data.encode && scale === 1 && sourceBlob.type === "image/webp"
      ? sourceBlob : await canvas.convertToBlob({ type: "image/webp", quality: 0.9 })) : null;
    const thumbnailBytes = blob?.type === "image/webp" ? new Uint8Array(await blob.arrayBuffer()) : null;
    thumbnail = canvas.transferToImageBitmap();
    canvas.width = canvas.height = 0;
    if (controller.signal.aborted) thumbnail.close();
    else self.postMessage({ id, bitmap: thumbnail, thumbnailBytes }, thumbnailBytes ? [thumbnail, thumbnailBytes.buffer] : [thumbnail]);
    thumbnail = null;
  } catch (error) {
    thumbnail?.close();
    self.postMessage({ id, error: error.message || globalThis.OpenCabinetI18n.t("msg.cc5537794c") });
  } finally {
    original?.close();
    jobs.delete(id);
  }
};
