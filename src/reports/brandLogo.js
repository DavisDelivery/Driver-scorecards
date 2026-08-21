// brandLogo.js — the Davis logo the printed reports put in their banner.
//
// There is no logo file in the repo, and a report that ships a placeholder is worse
// than one that says where the real mark comes from: the logo is uploaded once from
// the Reviews tab and kept in this browser as a data URI, so the PDF can draw it
// without a network fetch (jsPDF needs the bytes, not a URL). When nothing has been
// uploaded, the reports fall back to the drawn "D" mark they used before.
const KEY = "dds_brand_logo";

export function getBrandLogo() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw && raw.startsWith("data:image/") ? raw : "";
  } catch {
    return "";
  }
}

export function setBrandLogo(dataUri) {
  try {
    if (dataUri) localStorage.setItem(KEY, dataUri);
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false; // quota / private mode
  }
}

// Natural pixel size, so the banner can letterbox a wide logo instead of squashing
// it into a square. Resolves to null if the data URI won't decode.
export function logoSize(dataUri) {
  return new Promise((resolve) => {
    if (!dataUri) return resolve(null);
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve(null);
    img.src = dataUri;
  });
}
