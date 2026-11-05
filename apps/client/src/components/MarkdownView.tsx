import type { ReactNode } from "react";

/** Inline **bold** and _italic_ / *italic* (extracted from the original App.tsx). */
function renderBoldText(text: string): ReactNode[] {
  const boldParts = text.split(/(\*\*.*?\*\*)/g);
  return boldParts.flatMap((boldPart, i) => {
    if (boldPart.startsWith("**") && boldPart.endsWith("**")) {
      return (
        <strong key={`b-${i}`} style={{ color: "#fff", fontWeight: 800 }}>
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
            style={{ fontStyle: "italic", opacity: 0.85 }}
          >
            {italicPart.slice(1, -1)}
          </em>
        );
      }
      return italicPart;
    });
  });
}

/** Block-level renderer: headers, bullet lists, paragraphs. */
export default function MarkdownView({ text }: { text: string }) {
  return (
    <div className="markdown-container">
      {text.split("\n").map((line, i) => {
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith("# "))
          return <h1 key={i}>{renderBoldText(line.substring(2))}</h1>;
        if (trimmedLine.startsWith("## "))
          return <h2 key={i}>{renderBoldText(line.substring(3))}</h2>;
        if (trimmedLine.startsWith("### "))
          return (
            <h3 key={i} style={{ color: "#a855f7", marginTop: "16px" }}>
              {renderBoldText(line.substring(4))}
            </h3>
          );

        if (
          trimmedLine.startsWith("- ") ||
          trimmedLine.startsWith("* ") ||
          trimmedLine.startsWith("• ")
        ) {
          return (
            <li
              key={i}
              style={{
                marginLeft: "20px",
                marginBottom: "8px",
                listStyleType: "disc",
              }}
            >
              {renderBoldText(trimmedLine.substring(2))}
            </li>
          );
        }

        if (trimmedLine === "")
          return <div key={i} style={{ height: "12px" }} />;

        return (
          <p key={i} style={{ marginBottom: "12px" }}>
            {renderBoldText(line)}
          </p>
        );
      })}
    </div>
  );
}
