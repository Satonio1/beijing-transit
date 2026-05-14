# Beijing Transit

[English README](./README.md)

北京地铁出行查询工具 + 公开数据包，基于**官方公开计划时刻表**与本地结构化数据。它可以离线查询地铁计划下一班/末班风险；配置高德 WebService Key 后，可以做地址 / POI 到地址 / POI 的地铁-only 路线规划。

公开仓库： https://github.com/Satonio1/beijing-transit

> 本仓库返回的是**计划时刻**，不是实时到站。

## 能干嘛

### 不配置高德 API 也能用

- 查询北京地铁某站某方向的计划下一班。
- 查询首末班与末班风险。
- 给出轻量出行建议，比如“现在走还是等下一班”。
- 使用仓库自带的结构化时刻表 JSON 和查询索引。

### 需要配置高德 API 的功能

地址 / POI 路线规划需要高德 WebService Key（`AMAP_KEY`）。不配置时，以下能力不可用：

- `route --from <地点> --to <地点>`
- 地址 / POI 地理编码
- 公共地点之间的地铁-only 路线规划
- 高德兜底导航链接

核心时刻表命令 `next-train`、`last-train`、`decide` 不依赖 `AMAP_KEY`。

## 仓库结构

- `SKILL.md` — 助手使用指南
- `src/` — 运行代码
- `data/metro/structured-timetables/` — 结构化逐班时刻 JSON
- `data/metro/structured-timetable-index.json` — 查询索引
- `data/metro/metro-cache.json` — 线路 / 站点 / 首末班缓存
- `data/metro/validation-report.json` — 当前校验快照
- `scripts/build-structured-timetable-index.mjs`
- `scripts/validate-release-data.mjs`
- `.env.example`

## 快速开始

要求：Node.js `>=20`。

```bash
npm run build:index
npm run validate:data
```

## 使用示例

### 查询下一班

```bash
node src/cli.mjs next-train --line 10 --station 亮马桥 --to 三元桥 --now 21:36
```

### 查询末班风险

```bash
node src/cli.mjs last-train --line 10 --station 巴沟 --direction 内环 --now 22:20
```

### 决策建议

```bash
node src/cli.mjs decide --line 10 --from 巴沟 --direction 内环 --question "现在走还是等下一班" --now 21:40
```

### 公共地点之间的地铁-only 路线规划

先配置高德：

```bash
cp .env.example .env
# 在 .env 里填入 AMAP_KEY
```

然后运行：

```bash
node src/cli.mjs route --from 北京西站 --to 奥林匹克森林公园 --now 09:30
node src/cli.mjs route --from 北京南站 --to 国家图书馆 --now 14:00
```

## 高德 API 配置

从 `.env.example` 创建 `.env`：

```bash
cp .env.example .env
```

然后设置：

```text
AMAP_KEY=your_amap_webservice_key
```

这个 key 只在本地使用。不要提交 `.env`。

## 免责声明

- 本仓库仅用于**出行辅助和参考**，不适合作为安全关键或运营级决策依据。
- 数据可能不完整、过期、解析错误、结构化错误，或与现场情况不一致。
- 计划时刻**不等于**实时到站。
- 临时延误、跳停、限流、停运、封站、应急调整等情况，未必会体现在本项目结果里。
- 对时间敏感的出行，请务必以**车站现场信息、工作人员、运营方公告、官方 App / 官网**为准。
- 项目按 **as is** 提供，不对准确性、完整性、适用性作保证。

## 数据来源

本项目主要使用以下公开来源：

- 北京地铁公开页面：`bjsubway.com`
- 北京京港地铁公开页面 / API：`mtr.bj.cn`
- 北京市轨道交通运营管理有限公司公开页面：`bjmoa.cn`
- 高德 WebService：仅在配置后用于 POI 地理编码 / 地铁-only 路线规划 / 兜底链接

说明：

- `next-train` 只使用结构化后的**官方计划时刻表**。
- 高德**不作为**实时地铁到站数据源。
- 如果某条线路没有结构化好的官方计划时刻表，就不应该硬编下一班。

## 校验

```bash
npm run build:index
npm run validate:data
```

校验会检查结构化 JSON、查询索引、必需文件和校验报告是否一致。

## License / 来源说明

本仓库默认分发的是**结构化结果**，而不是原始时刻表图片。

二次使用或再分发时，请保留来源说明，并遵守原始公开来源条款。
