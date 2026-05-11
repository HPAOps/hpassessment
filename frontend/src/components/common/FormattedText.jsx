import React from "react";

// Renders test-content text that may contain inline formatting markers.
// Currently supported:
//   [U]text[/U]  → <u>text</u> (underline)
//
// The markers are produced by `extractDocxText` when it encounters runs with
// `<w:u/>` styling in the source .docx. They preserve the underline cues
// that questions like "What is the correct way to hyphenate the underlined
// phrase?" depend on.
//
// The output is a React fragment (safe — no innerHTML, no dangerouslySetInnerHTML).
export default function FormattedText({ text, as = "span", className }) {
  if (!text) return null;
  const Tag = as;
  const parts = [];
  const re = /\[U\]([\s\S]*?)\[\/U\]/g;
  let key = 0;
  let lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push(<React.Fragment key={key++}>{text.slice(lastIndex, m.index)}</React.Fragment>);
    }
    parts.push(<u key={key++} className="underline decoration-2 underline-offset-4">{m[1]}</u>);
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<React.Fragment key={key++}>{text.slice(lastIndex)}</React.Fragment>);
  }
  return <Tag className={className}>{parts}</Tag>;
}
