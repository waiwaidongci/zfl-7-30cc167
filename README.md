# 实验动物房笼位和饲养记录API

运行：

```bash
npm start
```

默认端口是`3007`，可用`PORT=3107 npm start`覆盖。数据会自动写入`data/lab.json`。

## 项目结构

```
├── server.js              # 入口：HTTP 服务器、路由分发
├── lib/
│   ├── helpers.js         # 公共工具：send / body / readQuery / loadDb / saveDb
│   ├── cageData.js        # 笼位数据操作：listCages / getCage / addCage / disableCage / countOccupancy
│   ├── cageValidator.js   # 笼位校验：存在性 / 停用 / 容量
│   ├── animalData.js      # 动物数据操作：listAnimals / getAnimal / addAnimal / batchAddAnimals
│   ├── animalValidator.js # 动物字段校验：必填字段 / 性别 / 出生日期格式
│   └── batchImportValidator.js # 批量导入校验：重复ID / 缺失笼位 / 容量冲突 / 预览
├── routes/
│   ├── cageRoutes.js      # 笼位路由处理
│   ├── animalRoutes.js    # 动物路由处理（含批量导入预览/确认）
│   └── feedingRoutes.js   # 饲喂路由处理
├── data/
│   ├── lab.json           # JSON 持久化存储
│   └── sample-import.json # 批量导入示例数据
├── scripts/
│   └── test-batch-import.js # 批量导入测试脚本
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

请求体字段说明：

| 字段              | 必填 | 说明                       |
| ----------------- | ---- | -------------------------- |
| id                | 否   | 动物编号，不传则自动生成   |
| strain            | 是   | 品系                       |
| cageId            | 是   | 所属笼位                   |
| sex               | 是   | 性别：male / female        |
| birthDate         | 是   | 出生日期，格式 YYYY-MM-DD  |
| project           | 是   | 所属项目                   |
| keeper            | 是   | 饲养员                     |
| observationNodes  | 否   | 观察节点日期数组           |

### GET /animals/:id

获取单个动物详情。

### POST /animals/:id/notes

添加饲养记录。

### POST /animals/:id/move

笼位移动，自动校验目标笼位。

### POST /animals/:id/remove

移出动物。

## 批量导入模块

### POST /animals/import/preview

批量导入预览，接收一组待建档动物，返回字段校验结果、重复ID、缺失笼位、容量冲突和可导入数量。

**请求体**：动物对象数组

**响应示例（200）**：

```json
{
  "total": 12,
  "importable": 7,
  "fieldErrors": [
    {
      "index": 6,
      "id": "ani-2005",
      "errors": [
        { "code": "missing_field", "field": "strain", "message": "缺少必填字段：strain" },
        { "code": "missing_field", "field": "project", "message": "缺少必填字段：project" },
        { "code": "missing_field", "field": "keeper", "message": "缺少必填字段：keeper" },
        { "code": "invalid_sex", "field": "sex", "message": "性别必须是 male 或 female，当前值：unknown" },
        { "code": "invalid_birth_date", "field": "birthDate", "message": "出生日期格式应为 YYYY-MM-DD，当前值：2026/03/10" }
      ]
    }
  ],
  "duplicateIds": [
    {
      "index": 3,
      "id": "ani-1001",
      "type": "exists_in_db",
      "message": "动物 ID ani-1001 已存在于数据库中"
    },
    {
      "index": 0,
      "id": "ani-2001",
      "type": "duplicate_in_batch",
      "message": "动物 ID ani-2001 在导入批次中重复出现"
    },
    {
      "index": 4,
      "id": "ani-2001",
      "type": "duplicate_in_batch",
      "message": "动物 ID ani-2001 在导入批次中重复出现"
    }
  ],
  "missingCages": [
    {
      "cageId": "X-99",
      "message": "笼位 X-99 不存在"
    }
  ],
  "capacityConflicts": [],
  "validItems": [
    {
      "index": 1,
      "id": "ani-2002",
      "strain": "C57BL/6J",
      "cageId": "A-01",
      "sex": "female",
      "birthDate": "2026-03-16",
      "project": "代谢观察",
      "keeper": "林青"
    }
  ]
}
```

**错误响应**：

| 状态码 | 错误码          | 说明                   |
| ------ | --------------- | ---------------------- |
| 400    | invalid_input   | 请求体不是数组         |
| 400    | empty_batch     | 导入批次为空           |

### POST /animals/import

确认批量导入，仅导入通过所有校验的动物记录。

**请求体**：动物对象数组（与预览接口相同）

**成功响应（201）**：

```json
{
  "imported": 7,
  "totalRequested": 12,
  "skipped": 5,
  "animals": [
    {
      "id": "ani-2002",
      "strain": "C57BL/6J",
      "cageId": "A-01",
      "sex": "female",
      "birthDate": "2026-03-16",
      "project": "代谢观察",
      "keeper": "林青",
      "status": "active",
      "observationNodes": [],
      "notes": [],
      "moves": []
    }
  ],
  "warnings": {
    "fieldErrors": [...],
    "duplicateIds": [...],
    "missingCages": [...],
    "capacityConflicts": [...]
  }
}
```

**错误响应**：

| 状态码 | 错误码            | 说明                       |
| ------ | ----------------- | -------------------------- |
| 400    | invalid_input     | 请求体不是数组             |
| 400    | empty_batch       | 导入批次为空               |
| 422    | no_importable_items | 没有可导入的有效记录    |

**校验规则**：

| 校验项       | 说明                                                         |
| ------------ | ------------------------------------------------------------ |
| 字段校验     | 必填字段缺失、性别值非法、出生日期格式错误等                 |
| 重复ID       | 与数据库中现有动物ID重复，或批次内ID重复                     |
| 缺失笼位     | 笼位ID不存在或笼位已停用                                     |
| 容量冲突     | 导入后笼位动物总数超过容量（按笼位维度叠加批次内所有动物）   |

> 提示：建议先调用 `/animals/import/preview` 预览校验结果，确认无误后再调用 `/animals/import` 执行导入。

## 报表接口

### GET /reports/stock

存栏统计（按项目、按笼位）。

### GET /reports/upcoming?days=7

即将到来的观察节点。
