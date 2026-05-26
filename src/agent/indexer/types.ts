/**
 * 项目索引类型。
 *
 * 当前索引是内存结构，后续可以落 SQLite 或向量库。
 */
export type ProjectFileKind =
  | "page"
  | "layout"
  | "api_route"
  | "component"
  | "agent"
  | "script"
  | "config"
  | "doc"
  | "source"
  | "asset"
  | "unknown";

export type ProjectFileIndex = {
  filePath: string;
  kind: ProjectFileKind;
  route?: string;
  exports: string[];
  imports: string[];
  apiMethods: string[];
  businessKeywords: string[];
  summary: string;
  size: number;
};

export type ProjectIndex = {
  workspaceRoot: string;
  generatedAt: string;
  files: ProjectFileIndex[];
  routes: ProjectFileIndex[];
  apiRoutes: ProjectFileIndex[];
  components: ProjectFileIndex[];
  keywords: Record<string, string[]>;
};
