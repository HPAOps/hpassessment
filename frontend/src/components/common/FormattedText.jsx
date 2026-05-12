import React from "react";

// Renders test-content text that may contain inline formatting markers.
// Currently supported:
//   [B]text[/B]  → <strong>
//   [I]text[/I]  → <em>
//   [U]text[/U]  → <u>
//
// The markers are produced by `extractDocxText` when it encounters runs
// styled with `<w:b/>`, `<w:i/>`, or `<w:u/>` in the source .docx, so the
// quiz preserves the exact bolds / italics / underlines from the booklet.
//
// Output is React elements (never `innerHTML` / `dangerouslySetInnerHTML`),
// so even though the source is admin-uploaded, an accidentally-malformed
// marker can't escape into the DOM as raw HTML.
function renderFormatted(text, keyBase = "f") {
  if (!text) return null;
  const re = /\[([BIU])\]/;
  const m = text.match(re);
  if (!m) return text;
  const tag = m[1];
  const start = m.index;
  const closeStr = `[/${tag}]`;
  const closeIdx = text.indexOf(closeStr, start + 3);
  if (closeIdx === -1) return text; // malformed -- return as-is

  const before = text.slice(0, start);
  const inner = text.slice(start + 3, closeIdx);
  const after = text.slice(closeIdx + closeStr.length);

  const Element = tag === "B" ? "strong" : tag === "I" ? "em" : "u";
  const cls = tag === "U" ? "underline decoration-2 underline-offset-4" : undefined;

  return (
    <React.Fragment>
      {before}
      <Element key={`${keyBase}-${start}`} className={cls}>
        {renderFormatted(inner, `${keyBase}-i${start}`)}
      </Element>
      {renderFormatted(after, `${keyBase}-a${closeIdx}`)}
    </React.Fragment>
  );
}

export default function FormattedText({ text, as = "span", className }) {
  if (!text) return null;
  const Tag = as;
  return <Tag className={className}>{renderFormatted(text)}</Tag>;
}
