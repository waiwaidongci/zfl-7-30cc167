# 实验动物房笼位和饲养记录API

运行：

```bash
npm start
```

默认端口是`3007`，可用`PORT=3107 npm start`覆盖。数据会自动写入`data/lab.json`。

## 项目结构

```
├── server.js              # 入口：HTTP 服务器、动物路由、校验集成
├── lib/
│   ├── helpers.js         # 公共工具：send / body / readQuery / loadDb / saveDb
│   ├── cageData.js        # 笼位数据操作：listCages / getCage / addCage / disableCage / countOccupancy
│   └── cageValidator.js   # 笼位校验：存在性 / 停用 / 容量
├── routes/
│   └── cageRoutes.js      # 笼位路由处理
├── data/
│   └── lab.json           # JSON 持久化存储
└── README.md
```

## 笼位模块接口

### GET /cages

获取笼位列表，返回每个笼位的实时占用数。

查询参数：

| 参数   | 说明               |
| ------ | ------------------ |
| area   | 按区域筛选         |
| rack   | 按笼架筛选         |
| status | 按状态筛选(active/disabled) |

响应示例：

```json
[
  {
    "id": "A-01",
    "area": "SPF区",
    "rack": "A",
    "capacity": 5,
    "status": "active",
    "createdAt": "2026-05-01T00:00:00.000Z",
    "occupancy": 1
  }
]
```

### GET /cages/:id

获取单个笼位详情及占用数。不存在返回 `404`。

### POST /cages

新增笼位。

请求体：

| 字段     | 必填 | 说明                       |
| -------- | ---- | -------------------------- |
| id       | 否   | 笼位编号，不传则自动生成   |
| area     | 是   | 所属区域                   |
| rack     | 是   | 所属笼架                   |
| capacity | 否   | 容量，默认5                |

- `area` 或 `rack` 缺失返回 `400`
- `id` 已存在返回 `409`

### POST /cages/:id/disable

停用笼位。将 `status` 设为 `disabled`，记录 `disabledAt` 时间。不存在返回 `404`。

> 停用后，该笼位将无法在动物建档（`POST /animals`）和笼位移动（`POST /animals/:id/move`）中被指定为目标笼位。

## 笼位校验

动物建档和笼位移动时，自动校验目标笼位：

| 校验项       | 错误码         | 说明               |
| ------------ | -------------- | ------------------ |
| 笼位是否存在 | cage_not_found | 笼位 ID 未注册     |
| 笼位是否停用 | cage_disabled  | 笼位已停用         |
| 是否超过容量 | cage_full      | 在栏数已达上限     |

校验失败返回 `422`，响应体：

```json
{
  "error": "cage_validation_failed",
  "details": [
    { "code": "cage_disabled", "message": "笼位 A-01 已停用" }
  ]
}
```

## 动物模块接口

### GET /animals?project=&cageId=&status=

查询动物列表。

### POST /animals

新增动物（建档），自动校验 `cageId` 对应笼位。

### GET /animals/:id

获取单个动物详情。

### POST /animals/:id/notes

添加饲养记录。

### POST /animals/:id/move

笼位移动，自动校验目标笼位。

### POST /animals/:id/remove

移出动物。

## 报表接口

### GET /reports/stock

存栏统计（按项目、按笼位）。

### GET /reports/upcoming?days=7

即将到来的观察节点。
