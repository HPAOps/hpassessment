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
  //    seen question number marker so each image attaches to the right qn.
  //    Two modes are supported:
  //
  //    a. Literal markers ("1)" "2)" ...) appearing in `<w:t>` runs.
  //    b. Word auto-numbered lists, where the question paragraph carries
  //       `<w:numPr><w:numId w:val=N/></w:numPr>` and the literal number
  //       isn't in the text at all (Word renders it from numbering.xml).
  //
  //    We try (a) first; if it produced 0 mappings, we re-scan with (b).
  //    Images BEFORE the first marker (logos, headers) are skipped.
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("Not a valid .docx (missing word/document.xml)");
  const docXml = await docFile.async("string");

  let imageByQn = scanLiteralMarkers(docXml);
  if (imageByQn.size === 0) {
    imageByQn = scanAutoNumberedList(docXml);
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

// Mode A: scan `<w:t>` text runs for literal question markers like "1)" "12)".
// Returns a Map<qn -> rId>. Only the first image after each marker wins.
function scanLiteralMarkers(docXml) {
  const tokenRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|r:embed="(rId\d+)"|r:link="(rId\d+)"/g;
  const qnRe = /(?:^|[\s>])(\d{1,3})\)\s*(?:$|[\s<])/;
  const imageByQn = new Map();
  let currentQn = null;
  let m;
  while ((m = tokenRe.exec(docXml)) !== null) {
    const txt = m[1];
    const rid = m[2] || m[3];
    if (txt) {
      const decoded = txt.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'");
      const padded = " " + decoded + " ";
      const qm = padded.match(qnRe);
      if (qm) {
        const n = parseInt(qm[1], 10);
        if (n > 0 && n < 1000) currentQn = n;
      }
    } else if (rid && currentQn !== null) {
      if (!imageByQn.has(currentQn)) imageByQn.set(currentQn, rid);
    }
  }
  return imageByQn;
}

// Mode B: scan for Word auto-numbered list paragraphs (`<w:numPr>`) which
// is how booklets that look like "1. 2. 3." or "1) 2) 3)" but rely on
// Word's automatic numbering work. We pick the MOST FREQUENT numId in the
// document — that's overwhelmingly the question list (Word uses different
// numIds for any sub-lists / answer choices that are also auto-numbered).
// We then auto-increment a counter starting at 1 for each occurrence.
function scanAutoNumberedList(docXml) {
  // First, find the dominant numId (the question list).
  const allNumIds = [...docXml.matchAll(/<w:numPr>[\s\S]*?<w:numId\s+w:val="(\d+)"[\s\S]*?<\/w:numPr>/g)]
    .map(x => x[1]);
  if (!allNumIds.length) return new Map();
  const counts = new Map();
  for (const id of allNumIds) counts.set(id, (counts.get(id) || 0) + 1);
  let dominant = null, max = 0;
  for (const [id, n] of counts) if (n > max) { dominant = id; max = n; }
  if (!dominant) return new Map();

  // Walk the doc in order. Each paragraph that opens a numPr with the
  // dominant numId is a question (qn = currentQn + 1). The next image
  // (rId via r:embed/r:link) belongs to that question.
  const tokenRe = /<w:numPr>([\s\S]*?)<\/w:numPr>|r:embed="(rId\d+)"|r:link="(rId\d+)"/g;
  const imageByQn = new Map();
  let currentQn = 0;
  let m;
  while ((m = tokenRe.exec(docXml)) !== null) {
    const numBlock = m[1];
    const rid = m[2] || m[3];
    if (numBlock) {
      const idMatch = numBlock.match(/<w:numId\s+w:val="(\d+)"/);
      if (idMatch && idMatch[1] === dominant) currentQn++;
    } else if (rid && currentQn > 0) {
      if (!imageByQn.has(currentQn)) imageByQn.set(currentQn, rid);
    }
  }
  return imageByQn;
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
// Returns paragraphs separated by "\n". Also honors soft line breaks
// (<w:br/>) inside a paragraph — these are produced by Shift+Enter in Word
// and matter for test booklets where a question stem, an excerpt, and a
// follow-up sentence are visually separated but live in one paragraph.
//
// Preserves the three inline formats that test booklets commonly rely on:
//   <w:b/>  → [B]…[/B]   (bold)
//   <w:i/>  → [I]…[/I]   (italic)
//   <w:u/>  → [U]…[/U]   (underline)
//
// Markers are nested in a stable order (B → I → U) when a single run has
// multiple formats. The `FormattedText` component renders them safely as
// real `<strong>` / `<em>` / `<u>` elements (no innerHTML).
//
// Why preserve formatting?  Test questions like "What is the correct way
// to hyphenate the **underlined phrase**?" or "Which **bolded** word…?"
// are unanswerable when the formatting is stripped.
function rprHas(rpr, tag) {
  // Match the run-property tag while respecting word boundary so that
  // <w:b…> isn't confused with <w:bCs…>, and <w:u…> isn't confused with
  // <w:rStyle…>.
  const tagRe = new RegExp(`<w:${tag}\\b([^>]*)/?>`, "i");
  const m = rpr.match(tagRe);
  if (!m) return false;
  const valMatch = (m[1] || "").match(/w:val=["']([^"']+)["']/i);
  if (valMatch) {
    const v = valMatch[1].toLowerCase();
    if (v === "false" || v === "0" || v === "none") return false;
  }
  return true;
}

export async function extractDocxText(file) {
  const zip = await JSZip.loadAsync(file);
  const docFile = zip.file("word/document.xml");
  if (!docFile) return "";
  const xml = await docFile.async("string");

  const out = [];
  const paragraphs = xml.split(/<\/w:p>/i);
  for (const p of paragraphs) {
    // Walk runs (<w:r>) and stray <w:br/> tokens in document order.
    const tokens = [];
    const re = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>|<w:br\s*\/?>/gi;
    let m;
    while ((m = re.exec(p)) !== null) {
      if (m[1] !== undefined) {
        const runContent = m[1];
        const rprMatch = runContent.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/i);
        const rpr = rprMatch ? rprMatch[1] : "";
        const isBold = rprHas(rpr, "b");
        const isItalic = rprHas(rpr, "i");
        const isUnderline = rprHas(rpr, "u");

        const inner = [];
        const innerRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:br\s*\/?>/gi;
        let im;
        while ((im = innerRe.exec(runContent)) !== null) {
          if (im[1] !== undefined) inner.push(decodeXmlEntities(im[1]));
          else inner.push("\n");
        }
        const text = inner.join("");
        if (text.trim() && (isBold || isItalic || isUnderline)) {
          // Place markers AROUND the visible text only, leaving any
          // leading/trailing whitespace outside so layout doesn't shift.
          const lead = text.match(/^\s*/)[0];
          const tail = text.match(/\s*$/)[0];
          let core = text.slice(lead.length, text.length - tail.length);
          if (isUnderline) core = `[U]${core}[/U]`;
          if (isItalic) core = `[I]${core}[/I]`;
          if (isBold) core = `[B]${core}[/B]`;
          tokens.push(`${lead}${core}${tail}`);
        } else {
          tokens.push(text);
        }
      } else {
        tokens.push("\n");
      }
    }
    const fullText = tokens.join("");
    for (const line of fullText.split(/\n/)) {
      if (line.trim()) out.push(line);
    }
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
