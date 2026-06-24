"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Normalize raw agent/terminal output before it hits the Markdown parser:
//  (a) trim leading/trailing blank space,
//  (b) dedent — strip the common leading-whitespace shared by every non-empty
//      line, so terminal indentation isn't misparsed as an indented code block,
//  (c) collapse runs of 3+ blank lines down to a single blank line (2 newlines).
function normalize(raw: string): string {
  const trimmed = raw.replace(/^\n+/, "").replace(/\s+$/, "");
  const lines = trimmed.split("\n");

  let minIndent = Infinity;
  for (const line of lines) {
    if (line.trim() === "") continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    if (indent < minIndent) minIndent = indent;
  }
  if (!Number.isFinite(minIndent)) minIndent = 0;

  const dedented = lines
    .map((line) => (line.length >= minIndent ? line.slice(minIndent) : line))
    .join("\n");

  // 3+ consecutive newlines -> exactly 2 (one blank line).
  return dedented.replace(/\n{3,}/g, "\n\n");
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="ask-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {normalize(children)}
      </ReactMarkdown>
    </div>
  );
}
