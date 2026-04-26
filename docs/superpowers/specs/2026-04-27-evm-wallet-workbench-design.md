# EVM Wallet Workbench Design

## Summary

本设计定义一个面向长期自用的本地 EVM 多账户桌面工作台。第一版目标是基于单助记词主仓，在 macOS 上提供多链账户管理、原生币余额与 nonce 扫描、专业模式原生币转账，以及本地历史追踪。应用采用 `React + TypeScript + Tauri`，其中 React 负责 UI 和只读链查询，Tauri/Rust 负责密钥、派生、签名、广播和本地持久化。

第一版只交付一个完整闭环：

`解锁主仓 -> 手动派生账户 -> 扫描余额/nonce -> 选择链与账户 -> 构建原生币转账 -> 手动确认 -> Rust 签名广播 -> 持久化历史 -> 状态更新`

## Product Scope

### In Scope

- 单助记词主仓，单密码解锁
- macOS 桌面应用
- 会话解锁，支持手动锁定与自动锁定
- 内置常用 EVM 主网，并允许自定义 RPC
- 手动派生账户，新增后立即扫描
- 原生币余额与 nonce 扫描和持久化
- 任意托管账户发起原生币转账
- 专业模式转账面板
- 本地交易历史与状态跟踪

### Out of Scope for V1

- 多助记词仓库
- 私钥导入、只读地址、硬件钱包
- ERC-20 转账与分发
- 合约 ABI 调用器
- 原始 calldata 发送
- 自动账户扫描
- 批处理任务、模板任务、策略编排
- 云同步、多人协作
- Windows 和 Linux 支持

### Future Expansion Reserved in Architecture

- `Erc20TransferAction`
- `BatchTransferAction`
- `ContractCallAction`
- `RawCalldataAction`
- 交易意图解析与未开源合约 calldata 解码

## Design Principles

1. 密钥材料只在 Rust 侧解密、派生和签名。
2. UI 只表达用户意图，不直接接触助记词或私钥。
3. 账户是链无关实体，余额和 nonce 是链相关状态。
4. 第一版优先手动、可控、可审计，不引入任务队列。
5. 历史数据必须支持回看失败原因与状态迁移。
6. 辅助缓存可以重建，关键密钥数据不能混存。

## Chosen Architecture

### Approach

采用“前端主导工作流 + Tauri 壳层 + Rust 能力桥”的架构：

- React + TypeScript 负责界面、表单状态、视图切换、只读 RPC 查询
- Tauri/Rust 负责 vault 加解密、BIP-44 派生、签名、广播、本地存储
- 只读查询可以由前端通过 RPC 完成
- 最终交易定稿、签名和广播必须统一走 Rust 命令通道

### Why This Approach

这个方案与当前 React 代码库衔接最好，能在第一版控制实现成本，同时保住桌面应用最重要的价值：把敏感能力从前端隔离出去。它也为后续 ERC-20、合约调用和解析模块保留了稳定的执行骨架。

## System Layers

### UI Layer

负责：

- 解锁界面
- 账户列表和账户详情
- 链选择与 RPC 配置
- 原生币转账表单和确认界面
- 历史记录与状态筛选
- 设置与锁定入口

UI 不负责：

- 助记词解密
- 私钥派生
- 交易签名
- 最终广播

### Application Layer

负责：

- 当前会话状态
- 当前链与当前账户选择
- 转账草稿生命周期
- 广播确认流
- 历史记录写入和界面刷新
- 只读查询与错误展示

### Wallet/Core Layer

负责：

- vault 加密与解密
- 主密码校验
- BIP-44 派生和索引推进
- 账户注册与本地标签
- 账户级链状态模型
- 交易请求校验与提交

### Platform Layer

由 Tauri 提供：

- 本地应用数据目录
- 文件读写
- 安全命令桥
- 生命周期事件
- 日志设施

## Data Model

### Vault

只存密钥相关数据：

- vault version
- KDF 参数
- 加密助记词密文
- 创建时间
- 最近成功解锁时间

`Vault` 是关键数据，必须独立存储，不能与业务缓存混在一起。

### AppConfig

只存应用配置：

- 默认链
- 启用的内置链
- 自定义 RPC 列表
- 自动锁定时长
- 显示偏好

### Account

账户本体是链无关实体：

- 派生索引
- 地址
- 标签
- 创建时间
- 是否隐藏

### AccountChainState

链上状态按 `account + chain` 维度存储：

- `chainId`
- `accountAddress`
- `nativeBalance`
- `nonce`
- `lastSyncedAt`
- `lastSyncError`

这条边界在第一版必须固定下来。后续代币持仓、授权、交互记录都继续挂在 `account + chain` 维度上。

### TxHistory

交易历史拆成三层：

- `Intent`
  - 用户在 UI 中发起的操作意图
  - 包含链、发送方、目标地址、金额、用户输入的 gas 参数
- `Submission`
  - 最终提交给 Rust 广播层的冻结交易参数
  - 包含最终 nonce、gasLimit、maxFeePerGas、maxPriorityFeePerGas、raw tx 摘要
- `ChainOutcome`
  - 广播哈希和链上最终状态
  - 包含 `pending`、`confirmed`、`failed`、`replaced`、`cancelled`

这样既能回看用户最初意图，也能看到最终实际上链的参数。

### Rebuild Boundary

- `Vault` 与 `AppConfig` 是不可轻易丢失的关键数据
- `Account` 是本地事实记录
- `AccountChainState` 与 `TxHistory` 属于辅助状态，可通过重扫和链上查询部分恢复

如果快照或历史损坏，系统应该重扫恢复，而不是判定整个 vault 损坏。

## Chain Model

### Built-in Networks

第一版内置常用 EVM 主网：

- Ethereum
- Base
- Arbitrum
- Optimism
- BSC
- Polygon

### Custom RPC

第一版支持为现有链添加自定义 RPC，也支持添加额外主网链定义，但必须遵守以下规则：

1. 用户输入 RPC URL 后，应用必须主动查询远端 `chainId`
2. `chainId` 必须作为链身份真相写入本地配置
3. 如果用户声称这是某条已知链，但远端返回的 `chainId` 不一致，必须拒绝保存
4. UI 展示的链名称不能覆盖真实 `chainId` 身份

不能只相信用户输入的链名或 RPC 描述。

## Account Derivation and Discovery

### Derivation Rule

第一版继续使用标准 EVM 路径：

`m/44'/60'/0'/0/i`

### Expansion Strategy

第一版采用：

- 手动新增账户
- 每次新增一个账户，只推进一个索引
- 生成账户后立即扫描一次
- 扫描并持久化的数据只包括当前默认链的 `native balance + nonce`

### Scan Scope

新增账户后的自动扫描只针对当前默认链。其他链在以下场景下再触发：

- 切到账户详情页
- 切换到对应链
- 用户手动刷新

这样可以控制 RPC 压力，并让默认行为保持可预测。

## Unlock and Session Model

### Unlock Strategy

第一版采用会话解锁：

- 启动应用后输入主密码解锁
- 解锁后当前会话内允许连续操作
- 手动锁定或应用退出后失效

### Auto Lock

虽然采用会话解锁，第一版仍支持自动锁定，触发条件包括：

- 应用退出
- 系统睡眠后恢复
- 空闲超时

自动锁定属于第一版安全体验的一部分，不视为可选装饰。

## Transfer Model

### Allowed Sender Scope

任意托管账户都可以独立发起原生币转账，不限制为单一主账户。

### Professional Transfer Panel

第一版默认展示并允许编辑：

- 目标地址
- 转账金额
- 当前链
- 发送账户
- 预估 gasLimit
- nonce
- maxFeePerGas
- maxPriorityFeePerGas

### Draft Freezing

用户点击确认后，系统必须生成不可变的 `transfer draft`。以下任意条件发生变化时，确认页失效，必须重新生成 draft：

- 当前链变化
- 发送账户变化
- 目标地址变化
- 金额变化
- nonce 被刷新或手动改动
- fee 参数变化

确认页展示的内容必须与最终提交给 Rust 的参数完全一致。

### Single Broadcast Path

前端可以做只读查询，但最终广播出口只能有一个：Rust 命令层。不能存在“有时前端广播、有时 Rust 广播”的双通道。

## Transaction Flow

### Step 1: Build Read Context

前端读取并展示：

- 当前链 `chainId`
- 发送账户地址
- 余额
- nonce
- fee data

### Step 2: Build Intent

前端生成 `Intent`：

- `chainId`
- `from`
- `to`
- `value`
- 用户输入的 `gasLimit`
- 用户输入的 `nonce`
- 用户输入的 `maxFeePerGas`
- 用户输入的 `maxPriorityFeePerGas`

### Step 3: Freeze Submission

用户确认后，把 intent 转为冻结的 `Submission` 并发给 Rust。Rust 侧再次校验：

- 账户属于当前 vault
- 链身份匹配
- 地址格式合法
- 余额足以覆盖 `value + gas`
- nonce 合法

Rust 侧完成最终交易构建、签名和广播。

### Step 4: Persist History

广播后立刻写本地历史：

- 先记 `pending`
- 保存 hash、冻结参数、原始意图

### Step 5: Update Outcome

状态更新后写入：

- `confirmed`
- `failed`
- `replaced`
- `cancelled`

历史记录不能只显示最终成功状态，必须保留中间迁移。

## Nonce and Pending Policy

第一版需要明确定义同一 `account + chain` 的并发边界。

### Editing Lock

同一 `account + chain` 同时只允许存在一个“待广播且可编辑中的交易草稿”。这能避免多笔草稿互相争抢 nonce。

### Local Nonce Reservation

一笔交易成功提交广播后，系统要在本地为对应 `account + chain` 预留 nonce，直到满足以下任一条件：

- 交易确认
- 交易被替换
- 交易被取消
- 用户主动重建状态

应用重启后，本地 nonce 预留状态应从持久化的 pending 历史中恢复，而不是仅依赖内存。

### Replacement Awareness

因为第一版允许专业模式和手动 fee/nonce，历史模型必须从一开始支持：

- `pending -> confirmed`
- `pending -> replaced`
- `pending -> cancelled`

## Error Handling

### Input Errors

包括：

- 地址格式错误
- 金额非法
- gas 参数非法

处理方式：

- 在表单层阻止进入确认页

### Context Errors

包括：

- 未连接链
- RPC 不可用
- 账户未解锁
- 账户不属于当前 vault

处理方式：

- 阻止提交
- 提供明确恢复动作

### Preflight Errors

包括：

- 余额不足
- nonce 过低
- gas 预估失败
- 链身份不匹配

处理方式：

- 在确认前标记并阻止广播

### Broadcast Errors

包括：

- `insufficient funds`
- `nonce too low`
- `replacement underpriced`
- RPC 拒绝
- 会话已锁定

处理方式：

- 写失败历史
- 保留原始意图和冻结参数
- 允许用户返回编辑并重试

### Post Submission Errors

包括：

- 长时间 pending
- 最终 reverted
- 被替换但未及时刷新

处理方式：

- 在历史中保留状态迁移
- 不覆盖失败原因

## Security Strategy

### Sensitive Material Rules

- 助记词只在 Rust 侧解密
- React 不接触明文助记词
- React 不接触派生私钥
- 敏感信息不写日志

### Storage Separation

本地文件至少分为：

- vault
- app config
- account registry
- chain snapshots
- tx history

### File Access Boundary

第一版只访问应用自己的数据目录，不默认访问用户其它目录，不默认导出明文数据。

### Confirmation Rule

虽然采用会话解锁，所有广播都必须经过确认页，确认页必须展示最终上链参数，而不是宽泛摘要。

## Refresh and Polling Strategy

第一版采用以下刷新与轮询策略：

- 按链节流
- 按视图刷新
- 手动刷新优先

默认行为：

- 账户列表只在进入页面、手动刷新、广播后刷新
- 历史页只轮询当前可见的 pending 交易
- 非当前链和非当前视图不做高频轮询

## V1 Screen Structure

### Unlock

负责主密码输入、解锁、锁定后的回跳。

### Accounts

布局：

- 左侧账户列表
- 右侧账户详情

支持：

- 新增账户
- 账户标签
- 当前默认链余额和 nonce 展示
- 手动刷新

### Transfer

负责：

- 链选择
- 发送账户选择
- 目标地址输入
- 金额输入
- nonce 和 fee 参数控制
- 生成确认草稿
- 发起广播

### History

负责：

- 查看本应用发起的交易
- 按链、账户、状态筛选
- 展示 intent、submission 和 chain outcome

### Settings

负责：

- 默认链
- 内置链启用
- 自定义 RPC
- 自动锁定时长
- 数据目录信息

## Module Boundaries

模块按以下边界拆分：

- `vault-core`
  - 加解密、密码校验、会话解锁和锁定
- `account-core`
  - BIP-44 派生、索引推进、账户标签
- `chain-registry`
  - 内置链定义、自定义 RPC、链元数据
- `chain-client`
  - 只读 RPC：余额、nonce、fee data、网络探测
- `tx-engine`
  - 原生币交易 intent 校验、submission 定稿、广播请求
- `storage`
  - vault、config、accounts、snapshots、history 持久化和迁移

## Testing Strategy

### Unit Tests

覆盖：

- vault 加解密
- 主密码校验
- 派生索引推进
- 自定义 RPC 链身份校验
- 转账草稿冻结规则
- 历史状态迁移

### Integration Tests

覆盖 Tauri 命令：

- 解锁
- 新增账户
- 扫描余额和 nonce
- 构建交易
- 签名广播
- 写入历史

### Local Chain Validation

开发与测试使用本地 EVM 节点，例如 `Anvil`，验证：

- 真实签名
- nonce 递增
- fee 参数
- pending
- confirmed
- replaced
- cancelled

产品对外只支持主网，不等于工程验证要依赖主网。

## Delivery Plan for V1

### Phase 1: Shell, Vault, Storage

完成：

- Tauri 应用壳
- 本地数据目录
- vault 文件格式
- 主密码解锁
- 基础设置持久化

### Phase 2: Accounts, Chains, Scan

完成：

- 账户派生
- 手动新增账户
- 默认链余额与 nonce 扫描
- 内置主网和自定义 RPC

### Phase 3: Native Transfer Loop

完成：

- 专业模式转账面板
- 确认页
- Rust 签名与广播
- 交易历史与状态更新

### Phase 4: Hardening

完成：

- 自动锁定
- 失败恢复
- 日志脱敏
- pending / replaced / cancelled 完整状态
- 数据迁移与损坏恢复策略

## Extension Path

后续新增动作时，统一沿用 `Intent -> Submission -> ChainOutcome` 模型：

- `NativeTransferAction`
- `Erc20TransferAction`
- `BatchTransferAction`
- `ContractCallAction`
- `RawCalldataAction`

后续加入交易意图解析时，也继续围绕这套模型扩展，不推翻历史结构。

## Final Decision Summary

第一版正式边界如下：

- 单助记词主仓
- macOS only
- React + TypeScript + Tauri
- 会话解锁
- 助记词加密落盘，主密码解锁
- React 做只读查询，Rust 做密钥、派生、签名和广播
- 内置常用 EVM 主网 + 自定义 RPC
- 手动新增账户，新增后扫描默认链余额和 nonce
- 任意托管账户都可发起原生币转账
- 专业模式转账面板
- 本地持久化账户快照和交易历史
- 为 ERC-20、批量分发、合约调用和 calldata 解析预留架构位置
