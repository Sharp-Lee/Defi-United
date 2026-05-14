export type AppModuleId =
  | "dashboard"
  | "accounts"
  | "assets"
  | "distribution"
  | "inscriptions"
  | "contracts"
  | "queueHistory"
  | "settings";

export type AppModuleStatus = "ready" | "planned";

export interface AppModuleDefinition {
  id: AppModuleId;
  label: string;
  summary: string;
  status: AppModuleStatus;
  planned: string[];
}

export const appModules: AppModuleDefinition[] = [
  {
    id: "dashboard",
    label: "总览",
    summary: "专业控制台首页，用于汇总 vault、链配置、账户规模和后续任务入口。",
    status: "planned",
    planned: ["工作台摘要", "风险提示", "近期队列与历史概览"],
  },
  {
    id: "accounts",
    label: "账户库",
    summary: "浏览器本地加密 vault、账户组、当前标签页热会话和派生账户。",
    status: "ready",
    planned: ["浏览器加密 vault", "账户组与地址标签", "当前标签页热会话"],
  },
  {
    id: "assets",
    label: "资产",
    summary: "查看选中本地账户的原生币和 watched ERC-20 只读余额快照。",
    status: "ready",
    planned: ["链校验后余额刷新", "Token watchlist", "失败与陈旧状态"],
  },
  {
    id: "distribution",
    label: "分发/归集",
    summary: "规划承载多账户分发、归集和批量执行队列。",
    status: "planned",
    planned: ["批量任务草稿", "共享 fee panel", "执行前确认与结果回执"],
  },
  {
    id: "inscriptions",
    label: "铭文刻录",
    summary: "规划承载 EVM calldata 铭文任务的模板、预览和批量刻录流程。",
    status: "planned",
    planned: ["铭文 payload 模板", "批量刻录预览", "gas 与 nonce 编排"],
  },
  {
    id: "contracts",
    label: "合约调用",
    summary: "规划承载 ABI 管理、只读调用、写入调用和 raw calldata 工作流。",
    status: "planned",
    planned: ["ABI 导入与缓存", "read/write 函数表单", "raw calldata 预览"],
  },
  {
    id: "queueHistory",
    label: "队列/历史",
    summary: "本地任务队列、脱敏交易历史、停止/恢复/重试和可恢复诊断。",
    status: "ready",
    planned: ["队列策略", "脱敏历史", "停止/恢复/重试"],
  },
  {
    id: "settings",
    label: "设置",
    summary: "链配置、RPC 配置、PWA 安装提示和本地数据边界说明。",
    status: "ready",
    planned: ["链/RPC 注册表", "本地存储分区", "PWA 安装与移动端偏好"],
  },
];
