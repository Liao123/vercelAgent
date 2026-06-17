/**
 * 模拟 UI 自动写盘：批准并执行最新 pending 文件审批。
 * 用法：node scripts/auto-apply-latest-pending.mjs [path-substring]
 */
const BASE = process.env.AGENT_BASE_URL ?? "http://localhost:3000";
const filter = process.argv[2] ?? "";

async function main() {
  const res = await fetch(`${BASE}/api/agent/approvals`, {
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "approvals fetch failed");

  const pending = (data.approvals ?? [])
    .filter((a) => a.status === "pending" && a.details)
    .filter((a) => {
      if (!filter) return true;
      const path =
        a.details?.preview?.path ??
        a.details?.evidence?.path ??
        "";
      return String(path).includes(filter);
    })
    .sort((a, b) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")),
    );

  const approval = pending[0];
  if (!approval) throw new Error("no matching pending approval");

  console.log("auto-apply:", approval.id, approval.details?.preview?.path ?? approval.details?.evidence?.path);

  const approveRes = await fetch(`${BASE}/api/agent/approvals`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId: approval.id, status: "approved" }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!approveRes.ok) {
    const err = await approveRes.json().catch(() => ({}));
    throw new Error(err.error ?? "approve failed");
  }

  const execRes = await fetch(`${BASE}/api/agent/approvals/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalId: approval.id }),
    signal: AbortSignal.timeout(120_000),
  });
  const execData = await execRes.json();
  if (!execRes.ok) throw new Error(execData.error ?? "execute failed");

  const pev = execData.postExecuteVerification;
  console.log("execution:", execData.approval?.execution?.status ?? "ok");
  if (pev?.triggered) {
    console.log("postExecute:", pev.success ? "passed" : "failed");
    console.log("summary:", pev.summary?.slice(0, 160));
  }
  console.log("auto-apply-latest-pending: PASSED");
}

main().catch((err) => {
  console.error("auto-apply-latest-pending: FAILED");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
