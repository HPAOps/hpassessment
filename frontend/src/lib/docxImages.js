// =============================================================================
// HPA -- Extract embedded images from a Word (.docx) test booklet
// =============================================================================
// A .docx is a ZIP of XML + media files. Each "question image" the user pastes
// into Word becomes a file inside `word/media/imageN.{png,jpg,...}`. The order
// in which the question images APPEAR in the document is the order of
// `<w:drawing>` elements inside `word/document.xml`, each carrying an
// `r:embed="rIdN"` reference. Resolving rIdN against `word/_rels/document.xml.rels`
// gives the actual media filename.
//
// We return [{ qn, blob, ext, dataUrl }] in document order, with `qn` starting
// at 1. This matches the existing imageMap shape used by TestImport.jsx.
// =============================================================================

import JSZip from "jszip";

export async function extractDocxImages(file) {
  const zip = await JSZip.loadAsync(file);

  // 1) Parse rels to get rId -> media path
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (!relsFile) throw new Error("Not a valid .docx (missing word/_rels/document.xml.rels)");
  const relsXml = await relsFile.async("string");
  const relsDoc = new DOMParser().parseFromString(relsXml, "application/xml");
  const rIdToTarget = new Map();
  for (const r of relsDoc.getElementsByTagName("Relationship")) {
    const id = r.getAttribute("Id");
    const target = r.getAttribute("Target"); // e.g. "media/image1.png"
    const type = r.getAttribute("Type") || "";
    if (id && target && type.endsWith("/image")) {
      rIdToTarget.set(id, target.startsWith("/") ? target.slice(1) : `word/${target}`);
    }
  }

  // 2) Read document.xml and walk it in order, tracking the most recently
  //    seen question number marker ("1)", "2)", etc.) so images BEFORE the
  //    first marker (logos, headers) are skipped, and each image attaches
  //    to the question number it appears under.
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Not a valid .docx (missing word/document.xml)");
  const docXml = await docFile.async("string");

  // Tokens: either an inline text block (to scan for "N)") or an image rId.
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|r:embed="(rId\d+)"|r:link="(rId\d+)"/g;
  // Match question number marker like "1)" "12)" "33)"
  const qnRe = /(?:^|[\s>])(\d{1,3})\)\s*(?:$|[\s<])/;

  const imageByQn = new Map(); // qn -> {rid, ext, blob, dataUrl} (first wins)
  let currentQn = null;

  let m;
  while ((m = tokenRe.exec(docXml)) !== null) {
    const txt = m[1];
    const rid = m[2] || m[3];
    if (txt) {
      // Decode entities and scan for "N)" — there can be multiple in one chunk
      const decoded = txt.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'");
      const padded = " " + decoded + " "; // pad so qnRe word boundaries work at edges
      const qm = padded.match(qnRe);
      if (qm) {
        const n = parseInt(qm[1], 10);
        if (n > 0 && n < 1000) currentQn = n;
      }
    } else if (rid && currentQn !== null) {
      // First image after this question number wins
      if (!imageByQn.has(currentQn)) {
        imageByQn.set(currentQn, rid);
      }
    }
  }

  // 3) Resolve each rId -> media file -> Blob
  const out = [];
  const sortedQns = [...imageByQn.keys()].sort((a, b) => a - b);
  for (const qn of sortedQns) {
    const rid = imageByQn.get(qn);
    const path = rIdToTarget.get(rid);
    if (!path) continue;
    const mediaFile = zip.file(path);
    if (!mediaFile) continue;
    const blob = await mediaFile.async("blob");
    const ext = (path.split(".").pop() || "png").toLowerCase();
    const mime = blob.type || mimeFor(ext);
    const typedBlob = blob.type ? blob : new Blob([await blob.arrayBuffer()], { type: mime });
    const dataUrl = await blobToDataUrl(typedBlob);
    out.push({ qn, ext, blob: typedBlob, dataUrl });
  }
  return out;
}

function mimeFor(ext) {
  switch (ext) {
    case "png":  return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif":  return "image/gif";
    case "webp": return "image/webp";
    case "bmp":  return "image/bmp";
    case "svg":  return "image/svg+xml";
    case "emf":  return "image/x-emf";
    case "wmf":  return "image/x-wmf";
    default:     return "application/octet-stream";
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

  // Plain-text extraction from a .docx (used to parse answer keys saved as Word).
// The regex requires either `<w:t>` exactly OR `<w:t ` followed by attrs, so
// it doesn't accidentally match `<w:tab/>` (Word's tab self-closing tag).
export async function extractDocxText(file) {
  const zip = await JSZip.loadAsync(file);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return "";
  const xml = await docFile.async("string");

  const out = [];
  const paragraphs = xml.split(/<\/w:p>/i);
  for (const p of paragraphs) {
    let line = "";
    const reText = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/gi;
    let m;
    while ((m = reText.exec(p)) !== null) {
      line += decodeXmlEntities(m[1]);
    }
    if (line.trim()) out.push(line);
  }
  return out.join("\n");
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
}
