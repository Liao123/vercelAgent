"use client";

type AgentRunModeHintProps = {
  mode: "loop" | "develop";
};

export function AgentRunModeHint({ mode }: AgentRunModeHintProps) {
  if (mode === "loop") {
    return (
      <p className="mt-1.5 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Agent Loop</span>
        ：模型多轮推理，自动读文件、搜索、准备 patch/改文件审批，支持附图与会话记忆。日常开发请用这个。
      </p>
    );
  }

  return (
    <p className="mt-1.5 text-[10px] leading-snug text-amber-800 dark:text-amber-200/90">
      <span className="font-medium">开发闭环</span>
      ：<strong>不调用模型</strong>，固定执行「索引 → 中文定位候选文件 →（仅当你通过 API
      传入 patch 时）预览/应用 patch → 可选 lint/build」。界面输入的自然语言
      <strong>不会</strong>自动生成代码，适合调试工具链或你已有现成 patch 时走一遍流程。
    </p>
  );
}
