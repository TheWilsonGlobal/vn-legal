// Section-heading detection for model answers, shared by MarkdownView and TurnView.

/** Check if a line is a section heading in the legal response. */
export function checkSectionHeader(line: string): {
  isHeader: boolean;
  title: string;
} {
  const trimmed = line.trim();
  if (!trimmed || trimmed.match(/^[-*_]{3,}$/) || trimmed.startsWith("```")) {
    return { isHeader: false, title: "" };
  }

  // Markdown headings (###, ##, #)
  const hMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
  if (hMatch) {
    return { isHeader: true, title: hMatch[1] };
  }

  // Numbered sections: "1. Pháp luật áp dụng", "2. Điều kiện có hiệu lực", etc.
  const numMatch = trimmed.match(
    /^(\d+)\.\s+(\*\*[^*]+\*\*|[A-ZÀ-Ỹ0-9][^:.\n]{2,80}:?)$/u,
  );
  if (numMatch) {
    return { isHeader: true, title: trimmed };
  }

  // Bold section labels: "**1. Pháp luật áp dụng**"
  const boldMatch = trimmed.match(
    /^\*\*(\d+\.\s+[^:*]+|Phần\s+[^:*]+|Chương\s+[^:*]+|Điều\s+[^:*]+)\*\*:?$/iu,
  );
  if (boldMatch) {
    return { isHeader: true, title: boldMatch[1] };
  }

  return { isHeader: false, title: "" };
}

/** Number of response sections (headings) in the text, as MarkdownView shows them. */
export function countResponseSections(text: string): number {
  return text.split("\n").filter((line) => checkSectionHeader(line).isHeader)
    .length;
}
