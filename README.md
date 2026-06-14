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
│   ├── batchImportValidator.js # 批量导入校验：重复ID / 缺失笼位 / 容量冲突 / 预览
│   ├── healthEventData.js # 健康异常事件：事件存储、状态流转、异常检测、重复合并、统计
│   └── feedingScheduler.js
├── routes/
│   ├── cageRoutes.js      # 笼位路由处理
│   ├── animalRoutes.js    # 动物路由处理（含批量导入预览/确认）
│   ├── feedingRoutes.js   # 饲喂路由处理（含健康异常自动检测）
│   ├── healthEventRoutes.js # 健康异常事件路由处理
│   └── breedingRoutes.js
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

### 动物状态说明

| 状态值               | 说明     | 参与库存统计 | 参与观察提醒 |
| -------------------- | -------- | ------------ | ------------ |
| `quarantine`         | 检疫中   | 否           | 否           |
| `released`           | 已放行   | 是           | 是           |
| `quarantine_abnormal`| 检疫异常 | 否           | 否           |
| `removed`            | 已移出   | 否           | 否           |

> 新动物建档默认进入 `quarantine`（检疫中）状态，需经过检疫记录、放行审批后进入 `released`（已放行）正式状态。

### GET /animals?project=&cageId=&status=

查询动物列表。可通过 `status` 参数按状态筛选。

### POST /animals

新增动物（建档），自动校验 `cageId` 对应笼位。新建动物默认状态为 `quarantine`（检疫中）。

请求体字段说明：

| 字段              | 必填 | 说明                       |
| ----------------- | ---- | -------------------------- |
| id                | 否   | 动物编号，不传则自动生成   |
| strain            | 是   | 品系                       |
| cageId            | 是   | 所属笼位（建议检疫区笼位） |
| sex               | 是   | 性别：male / female        |
| birthDate         | 是   | 出生日期，格式 YYYY-MM-DD  |
| project           | 是   | 所属项目                   |
| keeper            | 是   | 饲养员                     |
| observationNodes  | 否   | 观察节点日期数组           |
| status            | 否   | 初始状态，默认 quarantine  |

### GET /animals/:id

获取单个动物详情，包含检疫记录、审批信息等。

### POST /animals/:id/notes

添加饲养记录。

### POST /animals/:id/move

笼位移动，自动校验目标笼位。

### POST /animals/:id/remove

移出动物，状态变更为 `removed`。

## 检疫流程模块接口

### POST /animals/:id/quarantine/record

添加检疫记录。仅 `quarantine` 或 `quarantine_abnormal` 状态的动物可添加。

请求体字段：

| 字段         | 必填 | 说明                          |
| ------------ | ---- | ----------------------------- |
| date         | 否   | 检疫日期，默认当天            |
| temperature  | 否   | 体温                          |
| weight       | 否   | 体重                          |
| condition    | 否   | 整体状况描述                  |
| symptoms     | 否   | 症状列表（字符串数组）        |
| isAbnormal   | 否   | 是否标记异常，默认 false。设为 true 时自动将动物状态转为 quarantine_abnormal |
| notes        | 否   | 备注                          |
| examiner     | 否   | 检疫人员，默认取动物饲养员    |

成功响应（201）：返回新创建的检疫记录。

错误响应：

| 状态码 | 错误码          | 说明                     |
| ------ | --------------- | ------------------------ |
| 404    | animal_not_found | 动物不存在             |
| 422    | invalid_status   | 当前状态不允许添加检疫记录 |

### POST /animals/:id/quarantine/release

放行审批。将动物从检疫区转入正式笼位，状态变更为 `released`。仅 `quarantine` 或 `quarantine_abnormal` 状态可放行。

请求体字段：

| 字段         | 必填 | 说明                                        |
| ------------ | ---- | ------------------------------------------- |
| approver     | 否   | 审批人，默认取动物饲养员                    |
| targetCageId | 否   | 目标正式笼位 ID。提供时会校验笼位可用性，并自动执行移动 |
| notes        | 否   | 审批备注                                    |

成功响应（200）：返回更新后的动物信息。

错误响应：

| 状态码 | 错误码                 | 说明                   |
| ------ | ---------------------- | ---------------------- |
| 404    | animal_not_found       | 动物不存在             |
| 422    | invalid_status         | 当前状态不允许放行     |
| 422    | cage_validation_failed | 目标笼位校验失败       |

### POST /animals/:id/quarantine/abnormal

手动标记检疫异常。仅 `quarantine` 或 `quarantine_abnormal` 状态可操作。

请求体字段：

| 字段     | 必填 | 说明                     |
| -------- | ---- | ------------------------ |
| reason   | 否   | 异常原因，默认"检疫异常" |
| handler  | 否   | 处理人，默认取动物饲养员 |
| notes    | 否   | 异常备注                 |

成功响应（200）：返回更新后的动物信息。

### POST /animals/:id/quarantine/resolve

解除检疫异常，恢复为 `quarantine` 状态继续观察。仅 `quarantine_abnormal` 状态可操作。

请求体字段：

| 字段       | 必填 | 说明                           |
| ---------- | ---- | ------------------------------ |
| resolution | 否   | 处理结果，默认"已处理恢复检疫" |
| resolver   | 否   | 处理人，默认取动物饲养员       |

成功响应（200）：返回更新后的动物信息。

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

存栏统计（按项目、按笼位）。仅统计 `released`（已放行）状态的动物。

响应字段：

| 字段                | 说明                              |
| ------------------- | --------------------------------- |
| total               | 已放行动物总数                    |
| byProject           | 按项目分组的数量统计              |
| byCage              | 按笼位分组的数量统计              |
| quarantine          | 检疫中动物数量                    |
| quarantineAbnormal  | 检疫异常动物数量                  |

响应示例：

```json
{
  "total": 2,
  "byProject": {
    "代谢观察": 1,
    "免疫反应": 1
  },
  "byCage": {
    "A-01": 1,
    "B-03": 1
  },
  "quarantine": 1,
  "quarantineAbnormal": 1
}
```

### GET /reports/upcoming?days=7

即将到来的观察节点。仅统计 `released`（已放行）状态动物的观察节点。

## 数据迁移兼容

系统启动时自动执行数据迁移，兼容旧版数据：

- 旧状态 `active` → 新状态 `released`（已放行）
- 旧状态 `removed` → 新状态 `removed`（已移出）
- 自动为动物补充缺失的 `quarantineRecords` 字段（空数组）
- 自动为已放行动物补充缺失的 `enteredQuarantineAt` 字段（null）
- 自动初始化 `healthEvents` 集合
- 自动扫描历史 `notes` 和 `quarantineRecords`，为包含异常关键词的记录生成对应健康事件
- 自动扫描 `quarantine_abnormal` 状态动物，生成健康事件

迁移完成后会自动保存到 `data/lab.json`。

## 健康异常事件模块

### 模块概述

将饲养记录中的异常体况升级为可跟踪的健康事件系统。提交饲养记录时，如果 `condition`（体况描述）包含异常关键词或体重变化超过阈值，系统自动生成待处理健康事件。事件支持分派负责人、追加处理记录、关闭，并提供按项目/饲养员维度的统计报表。

### 事件状态流转

| 状态值       | 状态标签 | 说明                 | 可流转至                     |
| ------------ | -------- | -------------------- | ---------------------------- |
| `pending`    | 待处理   | 自动生成后初始状态   | assigned, in_progress, closed |
| `assigned`   | 已分派   | 已指定负责人         | in_progress, closed          |
| `in_progress`| 处理中   | 追加处理记录时自动进入 | closed                       |
| `closed`     | 已关闭   | 处理完成             | —（终态）                    |

### 自动异常检测规则

#### 1. 异常关键词检测（40+关键词）

**食欲类**：食欲下降、食欲差、食欲减退、食欲不振、不吃、拒食

**体重类**：消瘦、体重下降、体重减轻、掉膘

**消化类**：腹泻、拉稀、软便、粪便异常

**体温类**：发热、发烧、体温高

**精神类**：精神差、萎靡、呆滞、活动减少、嗜睡

**皮毛类**：毛发杂乱、毛发粗糙、脱毛、掉毛

**呼吸类**：咳嗽、打喷嚏、呼吸急促、气喘、呼吸困难

**外伤炎症类**：伤口、溃疡、出血、红肿、发炎

**行动神经类**：跛行、行动异常、抽搐、痉挛

**其他类**：呕吐、反胃、眼睛异常、眼屎、流泪、鼻子异常、流涕、异常、待观察、疑似

#### 2. 体重变化阈值检测

| 时间间隔 | 下降百分比阈值 | 说明 |
| -------- | -------------- | ---- |
| 0-2天    | ≥ 5%           | 日监测阈值 |
| 3天以上  | ≥ 10%          | 周监测阈值 |

当体重下降幅度超过对应阈值时，自动标记为「体重异常变化」。

### 重复异常合并规则

同一动物在 **3天窗口内** 存在未关闭的活动事件时，满足以下条件之一自动合并：
- 新异常与现有事件的关键词存在交集
- 无关键词交集时合并到最新的活动事件

合并操作会追加新关键词、更新体况描述、关联来源记录ID，并在事件 notes 中追加一条 `auto_merge` 类型的自动记录。

### 自动触发入口

以下接口提交数据时会自动触发异常检测：

1. **POST /feeding/checkin**（饲养打卡）
   - 读取 `condition` 或 `notes` 字段作为体况描述
   - 读取 `weight` 字段作为当前体重
   - `targetType=animal`：对单个动物检测
   - `targetType=cage`：遍历笼位内所有动物分别检测
   - 返回值中包含 `healthEvents` 数组，每个元素标明是否新建/合并及对应事件ID

2. **POST /animals/:id/notes**（添加饲养记录）
   - 读取 `condition` 字段作为体况描述
   - 读取 `weight` 字段作为当前体重
   - 返回值中包含 `healthEvent` 对象

3. **POST /animals/:id/quarantine/record**（添加检疫记录）
   - 组合 `condition` + `symptoms` + `notes` 作为体况描述
   - 读取 `weight` 字段作为当前体重
   - 当 `isAbnormal=true` 时强制创建事件（即使未匹配到关键词）
   - 返回值中包含 `healthEvent` 对象

4. **POST /animals/:id/quarantine/abnormal**（手动标记检疫异常）
   - 组合 `reason` + `notes` 作为体况描述
   - 自动添加「检疫标记异常」关键词
   - 返回值中包含 `healthEvent` 对象

### GET /health-events/meta

获取模块元数据：状态枚举、异常关键词列表、体重阈值。

响应示例：
```json
{
  "statuses": {
    "PENDING": "pending",
    "ASSIGNED": "assigned",
    "IN_PROGRESS": "in_progress",
    "CLOSED": "closed"
  },
  "abnormalKeywords": ["食欲下降", "食欲差", ...],
  "weightThreshold": {
    "WEEKLY_LOSS_PERCENT": 10,
    "DAILY_LOSS_PERCENT": 5
  }
}
```

### GET /health-events

查询健康事件列表。

查询参数：

| 参数       | 说明                                 |
| ---------- | ------------------------------------ |
| status     | 按状态筛选（pending/assigned/in_progress/closed） |
| project    | 按项目筛选                           |
| keeper     | 按饲养员筛选（事件所属动物的饲养员） |
| handler    | 按处理人筛选                         |
| animalId   | 按动物ID筛选                         |
| source     | 按事件来源筛选                       |
| fromDate   | 创建日期下限（YYYY-MM-DD）           |
| toDate     | 创建日期上限（YYYY-MM-DD）           |

事件 `source` 来源枚举：

| 来源值                         | 说明                               |
| ------------------------------ | ---------------------------------- |
| `feeding_checkin`              | 动物级饲养打卡自动生成             |
| `feeding_checkin_cage`         | 笼位级饲养打卡自动生成             |
| `animal_note`                  | 饲养 notes 自动生成                |
| `quarantine_record`            | 检疫记录自动生成（含关键词）       |
| `quarantine_record_abnormal`   | 检疫记录标记异常自动生成           |
| `quarantine_abnormal_mark`     | 手动标记检疫异常自动生成           |
| `historical_note`              | 历史 notes 迁移生成                |
| `historical_quarantine`        | 历史检疫记录迁移生成               |
| `historical_quarantine_abnormal`| 历史检疫异常标记迁移生成          |
| `historical_abnormal_mark`     | 历史 quarantine_abnormal 状态迁移生成 |
| `manual`                       | 手动创建                           |

### POST /health-events

手动创建健康事件。

请求体字段：

| 字段             | 必填 | 说明                                   |
| ---------------- | ---- | -------------------------------------- |
| animalId         | 是   | 动物ID                                 |
| condition        | 条件 | 体况描述（与 abnormalKeywords 二选一） |
| abnormalKeywords | 条件 | 异常关键词数组（与 condition 二选一）  |
| weight           | 否   | 当前体重（g）                          |
| assignee         | 否   | 指定负责人，提供时状态自动设为 assigned |
| notes            | 否   | 初始备注数组                           |
| source           | 否   | 来源标识，默认 manual                  |

错误响应：

| 状态码 | 错误码                        | 说明                   |
| ------ | ----------------------------- | ---------------------- |
| 400    | animalId_required             | 缺少 animalId          |
| 404    | animal_not_found              | 动物不存在             |
| 400    | condition_or_keywords_required | 缺少 condition 或关键词 |

### GET /health-events/:id

获取单个事件详情。不存在返回 `404`。

响应字段说明：

| 字段               | 类型    | 说明                                      |
| ------------------ | ------- | ----------------------------------------- |
| id                 | string  | 事件ID                                    |
| animalId           | string  | 关联动物ID                                |
| project            | string  | 所属项目（自动取自动物）                  |
| keeper             | string  | 饲养员（自动取自动物）                    |
| source             | string  | 事件来源                                  |
| sourceRecordId     | string  | 触发来源的记录ID                          |
| condition          | string  | 体况描述                                  |
| abnormalKeywords   | array   | 检测到的异常关键词数组                    |
| weightChange       | object  | 体重变化详情（见下表）                    |
| assignee           | string  | 分派负责人                                |
| status             | string  | 当前状态                                  |
| notes              | array   | 处理记录数组（每条含 type/content/createdAt/author） |
| createdAt          | string  | 创建时间 ISO                              |
| updatedAt          | string  | 更新时间 ISO                              |
| assignedAt         | string  | 分派时间 ISO                              |
| inProgressAt       | string  | 进入处理中时间 ISO                        |
| closedAt           | string  | 关闭时间 ISO                              |
| closeReason        | string  | 关闭原因                                  |
| relatedRecordIds   | array   | 所有关联来源记录ID（含合并的）            |

`weightChange` 对象结构：

| 字段           | 类型    | 说明              |
| -------------- | ------- | ----------------- |
| previousWeight | number  | 上次记录体重（g） |
| previousDate   | string  | 上次记录日期      |
| currentWeight  | number  | 当前体重（g）     |
| diff           | number  | 体重差值（g）     |
| percent        | number  | 变化百分比        |
| daysDiff       | number  | 间隔天数          |
| threshold      | number  | 应用阈值百分比    |
| isAbnormal     | boolean | 是否异常          |

### POST /health-events/:id/assign

分派事件负责人。仅未关闭事件可分派。`pending` 状态分派后自动进入 `assigned`。

请求体：

| 字段     | 必填 | 说明     |
| -------- | ---- | -------- |
| assignee | 是   | 负责人姓名 |

错误响应：

| 状态码 | 错误码       | 说明               |
| ------ | ------------ | ------------------ |
| 404    | event_not_found | 事件不存在      |
| 400    | assignee_required | 缺少负责人      |
| 422    | event_closed | 已关闭事件无法分派 |

### POST /health-events/:id/notes

追加处理记录。`pending` 或 `assigned` 状态追加后自动进入 `in_progress`。

请求体：

| 字段     | 必填 | 说明                                      |
| -------- | ---- | ----------------------------------------- |
| content  | 是   | 处理记录内容                              |
| type     | 否   | 记录类型（processing/medication/exam等），默认 processing |
| author   | 否   | 记录人，默认取 assignee 或 handler         |
| metadata | 否   | 附加元数据（如用药剂量、检查项目等）      |

### POST /health-events/:id/close

关闭事件。将状态设为 `closed`，记录关闭时间和原因。

请求体：

| 字段       | 必填 | 说明                       |
| ---------- | ---- | -------------------------- |
| reason     | 否   | 关闭原因，默认「处理完成」 |
| closer     | 否   | 关闭人                     |
| resolution | 否   | 处理结果摘要               |

错误响应：

| 状态码 | 错误码         | 说明           |
| ------ | -------------- | -------------- |
| 422    | already_closed | 事件已关闭     |

### POST /health-events/detect

异常检测预演接口，不创建事件，仅返回检测结果。用于前端在提交前提示用户。

请求体：

| 字段      | 必填 | 说明           |
| --------- | ---- | -------------- |
| animalId  | 是   | 动物ID         |
| condition | 否   | 体况描述       |
| weight    | 否   | 当前体重（g）  |

响应示例：
```json
{
  "animalId": "ani-1001",
  "condition": "食欲下降，精神差",
  "detectedKeywords": ["食欲下降", "精神差"],
  "weightChange": null,
  "wouldTriggerEvent": true,
  "reason": "检测到异常关键词：食欲下降、精神差"
}
```

### POST /health-events/migrate-historical

手动触发历史数据扫描迁移（系统启动时已自动执行，一般无需手动调用）。

响应：
```json
{
  "createdCount": 3,
  "mergedCount": 1,
  "total": 4
}
```

## 健康异常事件统计报表

### GET /health-events/stats

健康事件统计接口。

查询参数（均可组合使用）：

| 参数     | 说明                     |
| -------- | ------------------------ |
| project  | 按项目筛选               |
| keeper   | 按饲养员筛选             |
| handler  | 按处理人筛选             |
| assignee | 按分派负责人筛选         |
| fromDate | 统计区间起始（YYYY-MM-DD）|
| toDate   | 统计区间结束（YYYY-MM-DD）|

响应字段：

| 字段               | 类型    | 说明                                   |
| ------------------ | ------- | -------------------------------------- |
| total              | number  | 事件总数                               |
| byStatus           | object  | 按状态分组计数：{pending, assigned, in_progress, closed} |
| byStatusLabels     | object  | 状态中文标签映射                       |
| byProject          | object  | 按项目分组计数：{项目名: 数量, ...}    |
| byKeeper           | object  | 按饲养员分组计数：{饲养员: 数量, ...}  |
| topKeywords        | array   | 异常关键词 Top10，每项 {keyword, count} |
| avgProcessingHours | number  | 已关闭事件平均处理时长（小时）         |
| closeRate          | number  | 关闭率（百分比，两位小数）             |
| closedCount        | number  | 已关闭事件数量                         |
| filtersApplied     | object  | 本次统计应用的筛选条件                 |

### GET /reports/health-events

与 `/health-events/stats` 功能相同，作为报表入口，支持相同的筛选参数。归类于 `/reports` 命名空间下，便于报表系统统一调用。

响应示例：
```json
{
  "total": 12,
  "byStatus": {
    "pending": 2,
    "assigned": 1,
    "in_progress": 3,
    "closed": 6
  },
  "byStatusLabels": {
    "pending": "待处理",
    "assigned": "已分派",
    "in_progress": "处理中",
    "closed": "已关闭"
  },
  "byProject": {
    "疫苗测试": 4,
    "代谢观察": 3,
    "肿瘤研究": 2,
    "免疫反应": 3
  },
  "byKeeper": {
    "周遥": 7,
    "林青": 5
  },
  "topKeywords": [
    { "keyword": "食欲下降", "count": 5 },
    { "keyword": "发热", "count": 3 },
    { "keyword": "体重异常变化", "count": 2 }
  ],
  "avgProcessingHours": 18.45,
  "closeRate": 50.00,
  "closedCount": 6,
  "filtersApplied": {
    "project": null,
    "keeper": null,
    "fromDate": null,
    "toDate": null
  }
}
```

