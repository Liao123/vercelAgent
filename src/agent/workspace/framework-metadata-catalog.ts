/**
 * 各技术栈「页面元数据 / 包名」文件角色目录（A153）。
 * Gate 与 prompt 只认 role + framework，不写死用户问法。
 */
export type MetadataRole = "page_title" | "package_name";

export type FrameworkMetadataProfile = {
  id: string;
  frameworkMatchers: RegExp[];
  pageTitlePathPatterns: RegExp[];
  pageTitleLocateHints: string[];
};

const PACKAGE_JSON = /(?:^|\/)package\.json$/i;

const PROFILES: FrameworkMetadataProfile[] = [
  {
    id: "next",
    frameworkMatchers: [/next\.?js/i],
    pageTitlePathPatterns: [
      /(?:^|\/)src\/app\/layout\.tsx$/i,
      /(?:^|\/)app\/layout\.tsx$/i,
      /(?:^|\/)src\/app\/layout\.jsx$/i,
      /(?:^|\/)layout\.tsx$/i,
    ],
    pageTitleLocateHints: [
      "src/app/layout.tsx",
      "app/layout.tsx",
      "layout.tsx",
    ],
  },
  {
    id: "vue",
    frameworkMatchers: [/vue/i],
    pageTitlePathPatterns: [
      /(?:^|\/)index\.html$/i,
      /(?:^|\/)public\/index\.html$/i,
      /(?:^|\/)index\.vue$/i,
    ],
    pageTitleLocateHints: ["index.html", "public/index.html", "index.vue"],
  },
  {
    id: "vite",
    frameworkMatchers: [/vite/i],
    pageTitlePathPatterns: [/(?:^|\/)index\.html$/i, /(?:^|\/)public\/index\.html$/i],
    pageTitleLocateHints: ["index.html", "public/index.html"],
  },
  {
    id: "react",
    frameworkMatchers: [/^react$/i],
    pageTitlePathPatterns: [/(?:^|\/)index\.html$/i, /(?:^|\/)public\/index\.html$/i],
    pageTitleLocateHints: ["index.html", "public/index.html"],
  },
  {
    id: "svelte",
    frameworkMatchers: [/svelte/i],
    pageTitlePathPatterns: [/(?:^|\/)index\.html$/i, /(?:^|\/)src\/app\.html$/i],
    pageTitleLocateHints: ["index.html", "src/app.html"],
  },
];

const FALLBACK_PAGE_TITLE_PATTERNS = [
  /(?:^|\/)index\.html$/i,
  /(?:^|\/)layout\.tsx$/i,
  /(?:^|\/)src\/app\/layout\.tsx$/i,
];

function normalizePath(path: string): string {
  return path.trim().replaceAll("\\", "/");
}

export function resolveMetadataProfile(
  framework?: string | null,
): FrameworkMetadataProfile | null {
  if (!framework?.trim()) return null;
  const key = framework.trim();
  return (
    PROFILES.find((profile) =>
      profile.frameworkMatchers.some((re) => re.test(key)),
    ) ?? null
  );
}

export function pageTitlePatternsForFramework(
  framework?: string | null,
): RegExp[] {
  const profile = resolveMetadataProfile(framework);
  if (profile) return profile.pageTitlePathPatterns;
  return FALLBACK_PAGE_TITLE_PATTERNS;
}

export function pathMatchesMetadataRole(
  filePath: string,
  role: MetadataRole,
  framework?: string | null,
): boolean {
  const normalized = normalizePath(filePath);
  if (role === "package_name") {
    return PACKAGE_JSON.test(normalized);
  }
  return pageTitlePatternsForFramework(framework).some((pattern) =>
    pattern.test(normalized),
  );
}

export function hasMetadataRoleInPaths(
  filesRead: string[],
  role: MetadataRole,
  framework?: string | null,
): boolean {
  return filesRead.some((path) =>
    pathMatchesMetadataRole(path, role, framework),
  );
}

export function formatMetadataCatalogHints(framework?: string | null): string {
  const profile = resolveMetadataProfile(framework);
  if (profile) {
    return [
      `Framework metadata hints (${profile.id}): page title often in ${profile.pageTitleLocateHints.slice(0, 3).join(" | ")}; package name in package.json.`,
      "Pick paths via file.locate — no fixed mapping from user wording.",
    ].join(" ");
  }
  return [
    "Metadata hints (unknown framework): common page title files include index.html, layout.tsx, app layout; package name in package.json.",
    "Use file.locate then file.read — do not assume a single global path.",
  ].join(" ");
}

export function narrowMetadataPlanSteps(framework?: string | null): string[] {
  const profile = resolveMetadataProfile(framework);
  const locateHint =
    profile?.pageTitleLocateHints[0] ?? "index.html or layout/metadata file";
  return [
    "Disambiguate: workspace page title (HTML/metadata) vs package.json name vs embedded browser tab",
    `file.locate → file.read candidate page-metadata file (e.g. ${locateHint})`,
    "Optional: file.read package.json for project name cross-check",
    "Final with cited paths — skip browser.* unless user clearly means embedded tab",
  ];
}
