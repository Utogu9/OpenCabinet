(function (root) {
  "use strict";
  const types = { cover: "fanart_cover", back_cover: "fanart_back_cover",
    cart_front: "fanart_cart_front", cart_back: "fanart_cart_back", disc: "fanart_disc" };
  // Presentation only: keep the stored category and editor draft untouched.
  function resolve(images = []) {
    const result = images.filter(image => image.path).map(image => ({ ...image }));
    for (const [normal, alternative] of Object.entries(types)) {
      if (result.some(image => image.kind === normal && image.path)) continue;
      const fallback = result.find(image => image.kind === alternative && image.path);
      if (fallback) { fallback.source_kind = fallback.kind; fallback.kind = normal; }
    }
    return result;
  }
  // UV windows into ONE image: back | spine | front (or their vertical layout).
  // No canvas, image splitting, encoding or generated texture files.
  function wrapRegions({ width, height, depth }, axis = "x") {
    const panel = axis === "x" ? width : height, total = panel * 2 + depth;
    const region = (offset, extent) => {
      const size = `${total / extent * 100}%`, position = `${offset / (total - extent) * 100}%`;
      return axis === "x" ? { size: `${size} 100%`, position: `${position} 0%` }
        : { size: `100% ${size}`, position: `0% ${position}` };
    };
    return { back_cover: region(0,panel), spine: region(panel,depth), cover: region(panel+depth,panel) };
  }
  root.OpenCabinetImages = { resolve, wrapRegions };
})(typeof window !== "undefined" ? window : globalThis);
