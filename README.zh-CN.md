# polyVis

本仓库默认使用英文文档。

English entry:
[English README / README.md](/Users/jiahuaiyu/develop/hackthon/polyVis/README.md)

`polyVis` 现在是 Somnia Reactivity Mini Hackathon 的主项目结构：
`PolySignal - Somnia Reactive Trading Advisory Dashboard`。

项目以 `Foundry-first` 为主，内置 Clash Verge 代理适配，核心亮点是 Somnia 原生链上响应式流程：
实时 Polymarket 成交先被中继到 Somnia，Somnia 订阅自动触发响应式合约，最后前端消费链上的 `AlphaSignal` 结果。

## 项目概览

- `contracts/`
  - `PolymarketTradeBridge.sol`：接收 Polymarket 成交中继的 Somnia 桥合约。
  - `PolySignalReactive.sol`：Somnia 响应式处理合约，链上计算 8 种异常规则并发出 `AlphaSignal`。
  - `PolySignalAccessPass.sol`：最小可用的高级访问权限合约，用于钱包付费解锁。
  - `MockPolymarket.sol`：保留旧名称兼容层。
- `scripts/`
  - `fetchPolymarketData.js`：抓取 Gamma 市场元数据和 Polygon `OrderFilled` 日志到本地快照。
  - `relayPolymarketTrade.js`：把可疑 Polymarket 交易中继到 `PolymarketTradeBridge`。
  - `startRealtimeDashboard.js`：运行实时抓取循环并提供 dashboard 服务。
  - `deploy-foundry.sh`：部署 bridge、reactive contract 和 access pass。
  - `create-subscription.sh`：创建 Somnia 原生订阅。
  - `doctor.sh`：检查 Somnia RPC、Polygon RPC、Gamma API 和 relayer 身份。
- `scripts/lib/`
  - `proxy.js` / `proxy-env.sh`：注入 Clash Verge 代理环境。
  - `anomaly.js`：计算中继给链上的异常画像。
  - `reactiveSignal.js`：本地镜像链上信号判定逻辑，用于预览。
- `public/`
  - 浏览器 dashboard 资源，包括钱包连接和 Premium 解锁界面。
- `.env` / `.env.example`
  - 根目录运行配置。

## 为什么满足 Somnia Reactivity 要求

后端 relayer 只负责把 Polymarket 交易送进 Somnia。

真正的触发决策发生在链上：

1. 可疑 Polymarket 成交被标准化后发到 `PolymarketTradeBridge.logTrade(...)`
2. `PolymarketTradeBridge` 发出 `TradeBridged(...)`
3. Somnia 原生订阅设施捕获这个事件
4. Somnia 自动调用 `PolySignalReactive.onEvent(...)`
5. `PolySignalReactive` 在链上判断是否满足阈值，并在命中时发出 `AlphaSignal(...)`

也就是说，交易建议的触发不是 cron job，也不是传统后端事件循环决定的。

## 八种响应式规则

当前原型会把结构化异常画像中继到链上，再在 Somnia 上判断以下 8 类规则：

1. `NEW_WALLET_WHALE`
2. `HIGH_CONVICTION_ENTRY`
3. `RAPID_ACCUMULATION`
4. `SAME_SIDE_STREAK`
5. `COUNTERPARTY_CONCENTRATION`
6. `MARKET_IMPACT_SPIKE`
7. `WASH_CLUSTER`
8. `SMART_MONEY_FOLLOWTHROUGH`

这些指标虽然来自 Polymarket 的实时成交历史，但最后的触发仍然发生在 Somnia 上的 `PolySignalReactive` 合约里。

## 钱包与付费访问

项目现在已经补了一个最小可用的用户付费流程：

- 顶栏 `Connect Wallet`
- Somnia 上的 `PolySignalAccessPass`
- `Unlock Premium` 按钮
- 付费后解锁 `Alpha Signal Feed`
- 付费后解锁详细交易解释

当前这版最小模型使用 Somnia 原生 `STT` 支付，通过 `purchaseAccess()` 购买访问权限。

## 如何抓取 Polymarket 数据

现在根目录脚本已经内置了 Polymarket 数据抓取逻辑，因此原型不再依赖 `polyFake/`。

- 市场元数据来源：Gamma API
  - `question`
  - `conditionId`
  - `clobTokenIds`
  - `outcomePrices`
  - 活跃市场分页
- 链上成交真相来源：Polygon 交易日志
  - `CTF Exchange` 的 `OrderFilled`
  - `NegRisk Exchange` 的 `OrderFilled`

交易解码规则：

- `makerAssetId == 0` 表示用 USDC 买入
- `takerAssetId == 0` 表示对手方在卖 outcome token
- 非零资产 ID 就是 Polymarket outcome token ID

## 常用命令

```bash
npm install
cp .env.example .env
npm run doctor
npm run compile
npm run deploy:somnia
npm run subscribe:somnia
npm run relayer:address
npm start
```

启动后打开 `http://localhost:3000` 使用 dashboard。

## 部署说明

`npm run deploy:somnia` 现在会同时部署 3 个合约，并自动写回 `.env`：

- `POLYMARKET_TRADE_BRIDGE_ADDRESS`
- `POLYSIGNAL_REACTIVE_ADDRESS`
- `POLYSIGNAL_ACCESS_PASS_ADDRESS`

每次重新部署 bridge 或 reactive contract 后，都要重新执行：

```bash
npm run subscribe:somnia
```

因为 Somnia subscription 必须重新绑定到最新地址。

## Relayer 地址

`RELAYER_ADDRESS` 是实际向 `PolymarketTradeBridge` 提交 `logTrade(...)` 的 EOA 地址。

最简单的方式是直接使用 `PRIVATE_KEY` 推导出来的地址：

```bash
npm run relayer:address
```

或者直接运行：

```bash
cast wallet address --private-key "$PRIVATE_KEY"
```

脚本支持带或不带 `0x` 前缀的 `PRIVATE_KEY`。

## Clash / VPN 说明

项目会把 Clash 默认配置直接写进 `.env`，并在代码里自动加载。

- 默认 mixed proxy：`127.0.0.1:7898`
- Node 脚本自动从 `scripts/lib/proxy.js` 应用代理
- shell 脚本自动从 `scripts/lib/proxy-env.sh` 导出代理

如果 Somnia 或 Gamma 依然失败，可以执行：

```bash
npm run doctor
```

## Somnia Legacy Gas

Somnia RPC 可能不支持 EIP-1559 费用估算，因此项目默认启用 legacy gas。

- `.env`：`SOMNIA_USE_LEGACY_TX=true`
- 可选固定 gas price：`SOMNIA_GAS_PRICE_WEI=1000000000`

它会影响：

- `npm run deploy:somnia`
- `npm run subscribe:somnia`
- `npm run relay:trade`
- `npm start`
