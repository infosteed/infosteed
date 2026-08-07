// SPDX-License-Identifier: AGPL-3.0-only
import React from "react";
import { fromMarkdown } from "mdast-util-from-markdown";

interface MarkdownNode {
  type: string;
  value?: string;
  url?: string;
  title?: string | null;
  ordered?: boolean;
  start?: number | null;
  depth?: number;
  lang?: string | null;
  children?: MarkdownNode[];
}

function safeLinkHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function renderChildren(node: MarkdownNode, path: string): React.ReactNode[] {
  return (node.children ?? []).map((child, index) =>
    renderNode(child, `${path}-${index}`),
  );
}

function renderNode(node: MarkdownNode, key: string): React.ReactNode {
  switch (node.type) {
    case "root":
      return (
        <React.Fragment key={key}>{renderChildren(node, key)}</React.Fragment>
      );
    case "paragraph":
      return <p key={key}>{renderChildren(node, key)}</p>;
    case "text":
      return node.value ?? "";
    case "strong":
      return <strong key={key}>{renderChildren(node, key)}</strong>;
    case "emphasis":
      return <em key={key}>{renderChildren(node, key)}</em>;
    case "inlineCode":
      return <code key={key}>{node.value}</code>;
    case "code":
      return (
        <pre key={key}>
          <code className={node.lang ? `language-${node.lang}` : undefined}>
            {node.value}
          </code>
        </pre>
      );
    case "break":
      return <br key={key} />;
    case "link": {
      const href = safeLinkHref(node.url);
      return href ? (
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {renderChildren(node, key)}
        </a>
      ) : (
        <React.Fragment key={key}>{renderChildren(node, key)}</React.Fragment>
      );
    }
    case "list": {
      const children = renderChildren(node, key);
      return node.ordered ? (
        <ol key={key} start={node.start ?? undefined}>
          {children}
        </ol>
      ) : (
        <ul key={key}>{children}</ul>
      );
    }
    case "listItem":
      return <li key={key}>{renderChildren(node, key)}</li>;
    case "blockquote":
      return <blockquote key={key}>{renderChildren(node, key)}</blockquote>;
    case "heading": {
      const Heading = `h${Math.min(6, Math.max(1, node.depth ?? 2))}` as
        "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Heading key={key}>{renderChildren(node, key)}</Heading>;
    }
    case "thematicBreak":
      return <hr key={key} />;
    case "html":
      return node.value ?? "";
    default:
      return node.children ? (
        <React.Fragment key={key}>{renderChildren(node, key)}</React.Fragment>
      ) : (
        (node.value ?? null)
      );
  }
}

export function MarkdownContent({
  value,
  className,
}: {
  value: string;
  className?: string;
}) {
  const tree = fromMarkdown(value) as unknown as MarkdownNode;
  return (
    <div className={["markdown-content", className].filter(Boolean).join(" ")}>
      {renderChildren(tree, "markdown")}
    </div>
  );
}
