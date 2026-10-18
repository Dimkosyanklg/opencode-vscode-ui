import React from "react";

type FileKind = "code" | "data" | "doc" | "style" | "markup" | "image" | "shell" | "config" | "archive" | "default";

/** Base document outline shared by every file icon (16×16 viewBox). */
const OUTLINE = "M4.2 1.5h5.3L12.8 5v9.3a.7.7 0 0 1-.7.7H4.2a.7.7 0 0 1-.7-.7V2.2a.7.7 0 0 1 .7-.7Z";
const FOLD = "M9.5 1.5V5h3.3";

const KIND_COLOR: Record<FileKind, string> = {
  code: "#3b82c4",
  data: "#b9952f",
  doc: "#7a8794",
  style: "#b455b4",
  markup: "#d2692a",
  image: "#9b6bc4",
  shell: "#5f9e47",
  config: "#7c7c7c",
  archive: "#b0883f",
  default: "#8a8a8a",
};

/** Per-extension tints, so e.g. TypeScript, Python and Go read differently. */
const EXT_COLOR: Record<string, string> = {
  ts: "#3178c6",
  tsx: "#2f9bc4",
  js: "#b99a1f",
  jsx: "#c9a92a",
  py: "#3572a5",
  go: "#1a9ec4",
  rs: "#b46b3f",
  java: "#b07219",
  rb: "#b03a3a",
  php: "#787cb5",
  cs: "#3f8f5f",
  cpp: "#c04b6e",
  c: "#7a8fa8",
  css: "#b455b4",
  scss: "#c45c9c",
  less: "#c46a9a",
  html: "#d2692a",
  json: "#b9952f",
  yml: "#a04a4a",
  yaml: "#a04a4a",
  md: "#6f9fb5",
  sh: "#5f9e47",
  ps1: "#4f7fbf",
  svg: "#a074c4",
  png: "#a074c4",
  jpg: "#a074c4",
  jpeg: "#a074c4",
  gif: "#a074c4",
  webp: "#a074c4",
  pdf: "#c0563f",
};

const EXT_KIND: Record<string, FileKind> = {
  ts: "code",
  tsx: "code",
  js: "code",
  jsx: "code",
  mjs: "code",
  cjs: "code",
  py: "code",
  pyw: "code",
  go: "code",
  rs: "code",
  java: "code",
  kt: "code",
  kts: "code",
  c: "code",
  h: "code",
  cc: "code",
  cpp: "code",
  cxx: "code",
  hpp: "code",
  cs: "code",
  rb: "code",
  php: "code",
  swift: "code",
  scala: "code",
  lua: "code",
  r: "code",
  pl: "code",
  dart: "code",
  ex: "code",
  exs: "code",
  erl: "code",
  hs: "code",
  clj: "code",
  vue: "markup",
  svelte: "markup",
  astro: "markup",
  html: "markup",
  htm: "markup",
  xml: "markup",
  json: "data",
  jsonc: "data",
  json5: "data",
  yaml: "data",
  yml: "data",
  toml: "data",
  csv: "data",
  tsv: "data",
  sql: "data",
  graphql: "data",
  gql: "data",
  md: "doc",
  markdown: "doc",
  mdx: "doc",
  txt: "doc",
  rst: "doc",
  adoc: "doc",
  pdf: "doc",
  doc: "doc",
  docx: "doc",
  css: "style",
  scss: "style",
  sass: "style",
  less: "style",
  styl: "style",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "image",
  webp: "image",
  avif: "image",
  ico: "image",
  bmp: "image",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "shell",
  bat: "shell",
  cmd: "shell",
  env: "config",
  ini: "config",
  conf: "config",
  cfg: "config",
  properties: "config",
  lock: "config",
  zip: "archive",
  tar: "archive",
  gz: "archive",
  rar: "archive",
  "7z": "archive",
  bz2: "archive",
  xz: "archive",
};

const NAME_KIND: Record<string, FileKind> = {
  dockerfile: "config",
  makefile: "config",
  ".gitignore": "config",
  ".gitattributes": "config",
  ".editorconfig": "config",
  ".npmrc": "config",
  ".prettierrc": "config",
  ".eslintrc": "config",
  ".env": "config",
  readme: "doc",
  license: "doc",
  changelog: "doc",
  authors: "doc",
  notice: "doc",
};

/** Pick a shape and color for a file name (accepts `foo.ts:12-30` labels). */
function appearance(name: string): { kind: FileKind; color: string } {
  const base = name.replace(/:\d+(?:-\d+)?$/, "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const byName = NAME_KIND[base] ?? (base.startsWith(".env.") ? "config" : undefined);
  const dot = base.lastIndexOf(".");
  const ext = dot === -1 ? "" : base.slice(dot + 1);
  const kind = byName ?? EXT_KIND[ext] ?? "default";
  return { kind, color: EXT_COLOR[ext] ?? KIND_COLOR[kind] };
}

export function FileIcon({ name, size = 14 }: { name: string; size?: number }): React.ReactElement {
  const { kind, color } = appearance(name);
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={OUTLINE} stroke={color} strokeWidth="1.15" strokeLinejoin="round" />
      <path d={FOLD} stroke={color} strokeWidth="1.15" strokeLinejoin="round" />
      <g stroke={color} strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round">
        {glyph(kind)}
      </g>
    </svg>
  );
}

export function DirectoryIcon({ size = 14 }: { size?: number }): React.ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.3 1.5h4.6A1.5 1.5 0 0 1 13.5 6v4.9a1.5 1.5 0 0 1-1.5 1.5H3.5A1.5 1.5 0 0 1 2 10.9V4.5Z"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function glyph(kind: FileKind): React.ReactNode {
  switch (kind) {
    case "code":
      return <path d="M6.4 8.2 5 9.9l1.4 1.7M7.7 12l1.1-4.2M9.6 8.2 11 9.9l-1.4 1.7" />;
    case "data":
      return <path d="M5.5 8.5h5v3.7h-5zM5.5 10.2h5M8 8.5v3.7" />;
    case "doc":
      return <path d="M5.4 8.6h5.2M5.4 10.4h5.2M5.4 12.2h3.2" />;
    case "style":
      return <path d="M7.1 7.9 6.3 12M9.4 7.9 8.6 12M5.7 9.3h5.1M5.4 10.7h5.1" />;
    case "markup":
      return <path d="M6.8 8.1 5.2 9.9l1.6 1.8M9.2 8.1l1.6 1.8-1.6 1.8" />;
    case "image":
      return (
        <>
          <rect x="5.3" y="7.7" width="5.4" height="4.6" rx=".6" />
          <path d="M5.8 11.5 7.3 9.6l1 .9 1.2-1.4 1.2 2.4" />
          <circle cx="8.2" cy="9" r=".6" />
        </>
      );
    case "shell":
      return <path d="M5.6 8.3 7.4 9.9l-1.8 1.7M8.8 11.8h2.3" />;
    case "config":
      return (
        <>
          <circle cx="8" cy="9.9" r="1.1" />
          <path d="M8 7.2v.8M8 11.8v.8M5.2 9.9h.8M10 9.9h.8" />
        </>
      );
    case "archive":
      return <path d="M5.4 7.6h5.2v4.6H5.4zM5.4 9.1h5.2M7.2 7.6v.9M8.8 7.6v.9" />;
    default:
      return null;
  }
}
