import { useState, useId, type ReactNode } from "react";

/** Inline **bold** and _italic_ / *italic* */
function renderBoldText(text: string): ReactNode[] {
  const boldParts = text.split(/(\*\*.*?\*\*)/g);
  return boldParts.flatMap((boldPart, i) => {
    if (boldPart.startsWith("**") && boldPart.endsWith("**")) {
      return (
        <strong key={`b-${i}`} style={{ color: "#fff", fontWeight: 700 }}>
          {boldPart.slice(2, -2)}
        </strong>
      );
    }

    const italicParts = boldPart.split(/(_.*?_|\*.*?\*)/g);
    return italicParts.map((italicPart, j) => {
      if (
        (italicPart.startsWith("_") && italicPart.endsWith("_")) ||
        (italicPart.startsWith("*") && italicPart.endsWith("*"))
      ) {
        return (
          <em
            key={`i-${i}-${j}`}
            style={{ fontStyle: "italic", opacity: 0.9 }}
          >
            {italicPart.slice(1, -1)}
          </em>
        );
      }
      return italicPart;
    });
  });
}

/** Check if a line is a section heading in the legal response. */
function checkSectionHeader(line: string): {
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

/** Renders an array of text lines as clean, space-optimized block elements. */
function renderBlockLines(lines: string[]): ReactNode[] {
  const elements: ReactNode[] = [];
  let prevWasEmpty = false;

  lines.forEach((line, i) => {
    const trimmedLine = line.trim();

    // 1. OMIT standalone divider lines (---, ***, ___) to optimize space and remove clutter
    if (trimmedLine.match(/^[-*_]{3,}$/)) {
      return;
    }

    // 2. Bullet list items
    if (
      trimmedLine.startsWith("- ") ||
      trimmedLine.startsWith("* ") ||
      trimmedLine.startsWith("• ")
    ) {
      prevWasEmpty = false;
      elements.push(
        <li key={`li-${i}`} className="markdown-li">
          {renderBoldText(trimmedLine.substring(2))}
        </li>,
      );
      return;
    }

    // 3. Compact empty lines: collapse multiples to 1 small spacer
    if (trimmedLine === "") {
      if (!prevWasEmpty) {
        prevWasEmpty = true;
        elements.push(<div key={`sp-${i}`} className="markdown-spacer" />);
      }
      return;
    }

    prevWasEmpty = false;
    elements.push(
      <p key={`p-${i}`} className="markdown-p">
        {renderBoldText(line)}
      </p>,
    );
  });

  return elements;
}

interface SectionItem {
  id: string;
  title: string;
  lines: string[];
}

export default function MarkdownView({ text }: { text: string }) {
  const baseId = useId();

  // Parse lines into preamble and hierarchical sections
  const lines = text.split("\n");
  const preamble: string[] = [];
  const sections: SectionItem[] = [];
  let currentSec: SectionItem | null = null;

  lines.forEach((line, idx) => {
    const headerInfo = checkSectionHeader(line);
    if (headerInfo.isHeader) {
      currentSec = {
        id: `${baseId}-sec-${idx}`,
        title: headerInfo.title,
        lines: [],
      };
      sections.push(currentSec);
    } else if (currentSec) {
      currentSec.lines.push(line);
    } else {
      preamble.push(line);
    }
  });

  // Track expanded state for each section (all expanded by default)
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

  const isSectionOpen = (id: string) => expandedMap[id] !== false;

  const toggleSection = (id: string) => {
    setExpandedMap((prev) => ({
      ...prev,
      [id]: prev[id] === undefined ? false : !prev[id],
    }));
  };

  const setAllSections = (open: boolean) => {
    const nextMap: Record<string, boolean> = {};
    sections.forEach((s) => {
      nextMap[s.id] = open;
    });
    setExpandedMap(nextMap);
  };

  const hasSections = sections.length > 0;

  // If no sections were identified, render flat space-optimized lines
  if (!hasSections) {
    return <div className="markdown-container">{renderBlockLines(lines)}</div>;
  }

  const allSectionsOpen = sections.every((s) => isSectionOpen(s.id));

  return (
    <div className="markdown-container markdown-hierarchical">
      {/* Introduction paragraph before first section */}
      {preamble.length > 0 && (
        <div className="markdown-preamble">{renderBlockLines(preamble)}</div>
      )}

      {/* Mini section-hierarchy controller if multiple sections exist */}
      {sections.length >= 2 && (
        <div className="response-sections-header">
          <span className="sections-count muted">
            Cấu trúc phản hồi ({sections.length} phần):
          </span>
          <div className="sections-actions">
            <button
              type="button"
              className="btn-section-control"
              onClick={() => setAllSections(!allSectionsOpen)}
              title={
                allSectionsOpen
                  ? "Thu gọn tất cả các phần"
                  : "Mở rộng tất cả các phần"
              }
            >
              <span aria-hidden="true">{allSectionsOpen ? "▾ " : "▸ "}</span>
              {allSectionsOpen ? "Thu gọn các phần" : "Mở rộng các phần"}
            </button>
          </div>
        </div>
      )}

      {/* Hierarchical Collapsible Sections */}
      <div className="response-sections-list">
        {sections.map((sec) => {
          const open = isSectionOpen(sec.id);
          const nonDividerCount = sec.lines.filter(
            (l) => l.trim() && !l.trim().match(/^[-*_]{3,}$/),
          ).length;

          return (
            <div
              key={sec.id}
              className={`response-section-node${open ? " is-open" : " is-closed"}`}
            >
              <button
                type="button"
                className="response-section-header"
                aria-expanded={open}
                onClick={() => toggleSection(sec.id)}
              >
                <span className="toggle-chevron" aria-hidden="true">
                  {open ? "▾" : "▸"}
                </span>
                <span className="response-section-title">
                  {renderBoldText(sec.title)}
                </span>
                {!open && (
                  <span className="response-section-preview muted">
                    ({nonDividerCount} ý)
                  </span>
                )}
              </button>

              {open && (
                <div className="response-section-body">
                  {renderBlockLines(sec.lines)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
