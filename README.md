# 实验动物房笼位和饲养记录API

运行：

```bash
npm start
```

默认端口是`3007`，可用`PORT=3107 npm start`覆盖。数据会自动写入`data/lab.json`。

## 项目结构

```
├── server.js              # 入口：HTTP 服务器、路由分发、中间件链（认证→权限→路由→审计）
├── config/
│   └── api-keys.example.json # API Key 示例配置（生产请拷贝为 api-keys.json）
├── lib/
│   ├── helpers.js         # 公共工具：send / body(带缓存) / readQuery / loadDb / saveDb
│   ├── apiKeys.js         # API Key 加载与角色常量 ROLES(admin/keeper/readonly)
│   ├── auth.js            # 认证解析：extractApiKey / authenticate / requireRole
│   ├── permissions.js     # 权限判断：端点→动作映射、角色权限表、authorize()
│   ├── audit.js           # 审计日志：写入、按条件查询、统计、操作类型常量
│   ├── cageData.js        # 笼位数据操作
│   ├── cageValidator.js   # 笼位校验
│   ├── animalData.js      # 动物数据操作
│   ├── animalValidator.js # 动物字段校验
│   ├── batchImportValidator.js # 批量导入校验
│   ├── healthEventData.js # 健康异常事件
│   └── feedingScheduler.js
├── routes/
│   ├── cageRoutes.js      # 笼位路由
│   ├── animalRoutes.js    # 动物路由（含批量导入）
│   ├── feedingRoutes.js   # 饲喂路由
│   ├── healthEventRoutes.js # 健康事件路由
│   ├── breedingRoutes.js  # 繁育路由
│   └── auditRoutes.js     # 审计查询路由（仅 admin）
├── data/
│   ├── lab.json           # 业务数据持久化
│   ├── audit-logs.json    # 审计日志持久化（自动创建）
│   └── sample-import.json # 批量导入示例数据
├── scripts/
│   ├── test-batch-import.js  # 批量导入测试脚本
│   └── test-auth-audit.js    # 权限与审计最小验证脚本
└── README.md
```

## 多动物房与项目隔离模块

### 模块概述

将单一实验动物房扩展为多房间、多区域、多项目空间的隔离管理体系。每只动物、笼位、饲养员、报表和观察提醒都必须归属到明确房间或项目；旧数据启动后自动迁移到默认房间；查询接口支持按房间过滤，写接口防止动物被移动到无权限或不同房间的笼位。

### 核心数据模型

#### 1. 房间 (Room)

| 字段            | 类型   | 说明                                       |
| --------------- | ------ | ------------------------------------------ |
| `id`            | string | 房间ID，默认主房间为 `room-default`        |
| `name`          | string | 房间名称，如「主动物房」「新动物房」       |
| `building`      | string | 所属楼栋，如「实验楼A」                    |
| `floor`         | string | 楼层，如「3F」                             |
| `status`        | string | 状态：`active`/`maintenance`/`disabled`    |
| `capacity`      | number | 笼位总容量                                 |
| `climateControl`| object | 温湿度控制：`temperature`, `humidity`, `lightingSchedule` |
| `description`   | string | 房间描述                                   |
| `createdAt`     | string | 创建时间                                   |

#### 2. 区域 (Zone)

| 字段        | 类型   | 说明                                     |
| ----------- | ------ | ---------------------------------------- |
| `id`        | string | 区域ID，默认SPF区为 `zone-default`       |
| `roomId`    | string | 所属房间ID（必填）                       |
| `name`      | string | 区域名称：SPF区/普通区/检疫区/繁育区等   |
| `rackPrefix`| string | 笼架前缀，用于快速识别笼位归属           |
| `capacity`  | number | 区域容量                                 |
| `description`|string | 区域描述                                 |

#### 3. 项目空间 (Project)

| 字段                    | 类型   | 说明                                    |
| ----------------------- | ------ | --------------------------------------- |
| `id`                    | string | 项目ID，默认项目为 `project-default`    |
| `name`                  | string | 项目名称（唯一）                        |
| `roomId`                | string | 关联房间ID（可选）                      |
| `code`                  | string | 项目编号，如 `MET-01`                   |
| `status`                | string | 状态：`active`/`suspended`/`completed`  |
| `principalInvestigator` | string | 项目负责人                              |
| `targetSampleSize`      | number | 目标样本量                              |
| `description`           | string | 项目描述                                |

#### 4. 饲养员 (Keeper)

| 字段              | 类型     | 说明                                              |
| ----------------- | -------- | ------------------------------------------------- |
| `id`              | string   | 饲养员ID，如 `keeper-lq`                          |
| `name`            | string   | 姓名                                              |
| `employeeId`      | string   | 工号                                              |
| `status`          | string   | 状态：`active`/`inactive`/`leave`                 |
| `role`            | string   | 岗位：`keeper`/`senior_keeper`/`facility_manager` |
| `roomIds`         | string[] | 负责房间ID数组，`["*"]` 表示所有房间              |
| `defaultProjectId`| string   | 默认负责项目ID                                    |
| `contact`         | object   | 联系方式：`phone`, `email`                        |
| `specialties`     | string[] | 专业技能标签                                      |
| `permissions`     | object   | 操作权限：`allowWean`, `allowBreedingPair`, `allowQuarantineRelease`, `allowRoomAccess` |
| `joinDate`        | string   | 入职日期                                          |

### 数据归属关系

```
Room (动物房)
  └── Zone (区域)
        └── Cage (笼位) ──┐
                           ├─→ Animal (动物) ──┐
                           │                     ├── FeedingPlan / FeedingRecord
                           │                     ├── HealthEvent
                           │                     └── ObservationNode (观察提醒)
                           │
Project (项目空间) ────────┘
                           │
BreedingPair / BreedingLitter
```

- **推导规则**：动物的 `roomId`/`zoneId` 由其所在笼位推导得出
- **写入时强制**：新增笼位必须指定 `roomId`/`zoneId`；新增动物通过笼位自动归属
- **冗余存储**：动物、繁育、饲喂、健康事件均冗余存储 `roomId`/`zoneId`/`projectId`，便于直接过滤

### 旧数据自动迁移

系统启动时 `migrateDb()` 中自动执行 `migrateLegacyFacilityData()`：

1. **补齐集合**：创建缺失的 `rooms`/`zones`/`projects`/`keepers` 集合
2. **创建默认房间**：自动创建 `room-default`「主动物房」+ `zone-default`「SPF区」+ `project-default`「默认项目」
3. **笼位补全**：无 `roomId` 的笼位 → 按 `area` 匹配 Zone，找不到则归默认房间/区域
4. **动物补全**：无 `roomId` 的动物 → 从笼位推导或用默认
5. **项目创建**：扫描动物/繁育中出现的 `project` 名称 → 自动创建 Project 记录并填充 `projectId`
6. **饲养员创建**：扫描动物/事件中出现的 `keeper` 姓名 → 自动创建 Keeper 记录
7. **业务记录补全**：为历史 `feedingPlans`/`feedingRecords`/`breedingPairs`/`breedingLitters`/`healthEvents` 补充 `roomId`/`zoneId`/`projectId`

迁移完成后自动保存到 `data/lab.json`，旧版数据无需手动处理。

### 房间/项目级权限配置

在 API Key 配置中新增三个可选白名单字段（见 `config/api-keys.example.json`）：

| 字段               | 类型       | 说明                                             | 默认值    |
| ------------------ | ---------- | ------------------------------------------------ | --------- |
| `allowedRoomIds`   | `string[]` | 允许访问的房间ID，`["*"]` 表示全部               | `["*"]`   |
| `allowedProjectIds`| `string[]` | 允许访问的项目ID，`["*"]` 表示全部               | `["*"]`   |
| `allowedZones`     | `string[]` | 允许访问的区域（暂用于前端展示）                 | `["*"]`   |

示例（饲养员林青仅允许主动物房）：
```json
{
  "key": "keeper-key-demo-001",
  "role": "keeper",
  "name": "饲养员-林青",
  "allowedRoomIds": ["room-default"],
  "allowedProjectIds": ["*"]
}
```

### 跨房间移动校验

动物移动（`POST /animals/:id/move`）和检疫放行（`POST /animals/:id/quarantine/release`）自动在 `cageValidator.js` 中执行：

| 校验场景                           | 错误码                     | 说明                                     |
| ---------------------------------- | -------------------------- | ---------------------------------------- |
| 无目标房间权限                     | `cage_room_no_permission`  | 当前用户未被授予目标笼位所在房间的访问权 |
| 源房间与目标房间不一致且角色非admin| `cross_room_move_not_allowed` | 饲养员角色不可跨房间移动动物          |
| 目标房间被拒绝访问                 | `target_room_access_denied`| 权限白名单校验不通过                     |

> 校验逻辑位于 `lib/cageValidator.js` 的 `validateCageForAnimal()`，非管理员用户会自动检查目标房间权限和跨房间移动合法性，不集中在 `server.js` 判断。

### 设施模块接口

#### GET /facility/overview

设施概览：返回所有房间、区域、项目、饲养员列表 + 按房间维度的笼位使用统计。非管理员自动按 `allowedRoomIds` 过滤。

#### GET /facility/defaults

返回默认房间/区域/项目ID：
```json
{
  "defaultRoomId": "room-default",
  "defaultZoneId": "zone-default",
  "defaultProjectId": "project-default"
}
```

#### GET /rooms?status=&building=

查询房间列表，支持按状态和楼栋过滤。

#### GET /rooms/:id

房间详情。非管理员需在 `allowedRoomIds` 白名单内，否则返回 `403`。

#### POST /rooms [admin]

新增房间。必填字段：`name`。

#### PATCH /rooms/:id [admin]

更新房间信息。

#### GET /zones?roomId=

查询区域列表，支持按房间过滤。

#### GET /zones/:id

区域详情，按所属房间校验权限。

#### POST /zones [admin]

新增区域。必填字段：`name`, `roomId`。

#### GET /projects?status=&roomId=

查询项目空间列表。

#### GET /projects/:id

项目详情。

#### POST /projects [admin]

新增项目。必填字段：`name`；可选：`roomId`（项目绑定房间）。

#### PATCH /projects/:id [admin]

更新项目信息。

#### GET /keepers?status=&roomId=

查询饲养员列表。非管理员仅能看到 `active` 状态。

#### GET /keepers/:id

饲养员详情。

#### POST /keepers [admin]

新增饲养员。必填字段：`name`。

#### PATCH /keepers/:id [admin]

更新饲养员信息。

#### GET /resolve/room-by-cage/:cageId

根据笼位ID反向解析所属房间/区域，供前端下拉联动使用。

### 查询过滤汇总

所有列表接口均新增以下过滤参数（路由层 → 数据层逐层透传）：

| 模块接口              | 新增过滤参数                         |
| --------------------- | ------------------------------------ |
| `GET /cages`          | `roomId`, `zoneId`                   |
| `GET /animals`        | `roomId`, `zoneId`, `keeper`, `projectId` |
| `GET /reports/stock`  | `roomId`, `projectId`                |
| `GET /reports/upcoming` | `roomId`                           |
| `GET /reports/health-events` | `roomId`                       |
| `GET /feeding/plans`  | `roomId`, `project`                  |
| `GET /feeding/records`| `roomId`, `project`                  |
| `GET /breeding/pairs` | `roomId`, `zoneId`, `project`        |
| `GET /breeding/litters`| `roomId`, `zoneId`, `cageId`        |
| `GET /breeding/stats` | `roomId`, `projectId`                |
| `GET /health-events`  | `roomId`                             |
| `GET /health-events/stats` | `roomId`                        |

### 报表口径扩展

#### GET /reports/stock

响应新增以下字段：

| 字段           | 说明                              |
| -------------- | --------------------------------- |
| `byProjectId`  | 按项目ID分组（替代旧版 `byProject` 按名称分组） |
| `byRoom`       | 按房间ID分组的数量统计            |

#### GET /reports/upcoming

每条观察节点记录新增归属信息：

| 字段       | 来源           |
| ---------- | -------------- |
| `roomId`   | 动物.roomId    |
| `zoneId`   | 动物.zoneId    |
| `projectId`| 动物.projectId |

#### GET /reports/health-events / GET /health-events/stats

统计维度新增：
- `byRoom`：按房间ID分组计数
- `roomId`：筛选参数

### 种子数据

启动时若无 `data/lab.json`，自动生成演示数据：

**3 个房间**：主动物房、新动物房、独立检疫楼
**6 个区域**：SPF区、普通区、检疫区、繁育区、转基因区、特殊项目区
**7 个项目**：默认、代谢、免疫、肿瘤、疫苗、繁育、转基因
**3 名饲养员**：林青（仅主房）、周遥（主房+新动物房）、管理员（所有）
**所有笼位/动物/繁育/饲喂/健康事件**：均按笼位→区域→房间链条正确归属对应 `roomId`/`zoneId`/`projectId`

---

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

## API Key 权限模块

### 认证方式

所有业务接口（除 `/healthz` 和 `/_ping`）均需携带有效 API Key。支持两种传递方式：

**方式一：自定义 Header（推荐）**
```
X-API-Key: admin-key-demo-001
```

**方式二：Bearer Token**
```
Authorization: Bearer admin-key-demo-001
```

认证失败返回 `401`，响应体：
```json
{ "error": "missing_api_key", "message": "缺少 X-API-Key Header 或 Authorization: Bearer <key>" }
```

### 角色定义

| 角色       | 常量值     | 权限动作                  | 说明                     |
| ---------- | ---------- | ------------------------- | ------------------------ |
| 管理员     | `admin`    | READ / WRITE / ADMIN      | 可执行所有操作           |
| 饲养员     | `keeper`   | READ / WRITE              | 可读写业务数据，不可管理 |
| 只读用户   | `readonly` | READ                      | 仅查询，不可写           |

权限继承关系：`admin > keeper > readonly`

### 权限动作分级

| 动作    | 说明                  | 允许角色                 |
| ------- | --------------------- | ------------------------ |
| READ    | 所有 GET 查询         | admin / keeper / readonly |
| WRITE   | 业务写操作（建档/记录/移笼/移出/饲喂/繁育/健康事件等） | admin / keeper |
| ADMIN   | 管理操作（笼位增删、历史迁移、审计查询） | admin only |

### 接口权限矩阵（节选）

| 接口                                     | 方法 | 动作  | 需要角色 |
| ---------------------------------------- | ---- | ----- | -------- |
| GET /animals, GET /cages                 | GET  | READ  | 三角色均可 |
| POST /animals                            | POST | WRITE | keeper+  |
| POST /animals/:id/notes                  | POST | WRITE | keeper+  |
| POST /animals/:id/move                   | POST | WRITE | keeper+  |
| POST /animals/:id/remove                 | POST | WRITE | keeper+  |
| POST /animals/:id/quarantine/*           | POST | WRITE | keeper+  |
| POST /feeding/*, /breeding/*, /health-events (除migrate) | POST | WRITE | keeper+ |
| POST /cages, POST /cages/:id/disable     | POST | ADMIN | admin    |
| POST /health-events/migrate-historical   | POST | ADMIN | admin    |
| GET /audit/* (所有审计查询)              | GET  | ADMIN | admin    |

权限不足返回 `403`，响应体：
```json
{
  "error": "insufficient_permission",
  "message": "角色 readonly 无权执行 write 操作 POST /animals",
  "requiredRole": "keeper"
}
```

### API Key 配置

配置文件优先加载顺序：
1. `config/api-keys.json`（生产使用，不提交到版本库）
2. `config/api-keys.example.json`（示例，已内置 4 个测试 Key）

配置格式：
```json
{
  "apiKeys": [
    {
      "key": "admin-key-demo-001",
      "role": "admin",
      "name": "系统管理员",
      "description": "所有权限",
      "createdAt": "2026-01-01T00:00:00.000Z"
    },
    {
      "key": "keeper-key-demo-001",
      "role": "keeper",
      "name": "饲养员-林青",
      "description": "日常业务操作"
    },
    {
      "key": "readonly-key-demo-001",
      "role": "readonly",
      "name": "只读用户-审计员",
      "description": "数据查询与审计"
    }
  ]
}
```

**内置示例 Key**（仅用于开发测试，生产请替换）：

| 用途     | Key 值                  | 角色     |
| -------- | ----------------------- | -------- |
| 管理员   | `admin-key-demo-001`    | admin    |
| 饲养员   | `keeper-key-demo-001`   | keeper   |
| 饲养员   | `keeper-key-demo-002`   | keeper   |
| 只读     | `readonly-key-demo-001` | readonly |

### 根端点认证信息

`GET /` 返回当前认证上下文与权限矩阵：
```json
{
  "auth": {
    "enabled": true,
    "apiKeySource": "config/api-keys.example.json",
    "currentUser": { "role": "admin", "name": "系统管理员" },
    "roles": ["admin", "keeper", "readonly"],
    "permissions": {
      "readonly": ["read"],
      "keeper": ["read", "write"],
      "admin": ["read", "write", "admin"]
    }
  }
}
```

---

## 操作审计模块

### 审计范围

以下所有写操作自动写入审计日志（不阻塞请求响应，`setImmediate` 异步写入）：

| 操作类型                 | 说明                     |
| ------------------------ | ------------------------ |
| `animal.create`          | 动物建档                 |
| `animal.add_note`        | 添加饲养记录             |
| `animal.move`            | 笼位移动                 |
| `animal.remove`          | 移出动物                 |
| `animal.quarantine_*`    | 检疫流程（记录/放行/异常/解除） |
| `animal.batch_import`    | 批量导入                 |
| `cage.create` / `cage.disable` | 笼位管理            |
| `feeding.plan_*` / `feeding.checkin` | 饲喂操作        |
| `breeding.pair_*` / `breeding.litter_*` | 繁育操作    |
| `health.event_*`         | 健康事件（创建/分派/记录/关闭） |
| `health.migrate_historical` | 历史数据迁移         |

### 审计日志结构

每条日志完整记录请求、响应、操作者、关联动物 ID：

```json
{
  "id": "audit-1",
  "timestamp": "2026-07-08T10:30:00.000Z",
  "operation": "animal.create",
  "operator": {
    "key": "keeper-key-demo-001",
    "role": "keeper",
    "name": "饲养员-林青"
  },
  "request": {
    "method": "POST",
    "pathname": "/animals",
    "query": {},
    "body": { "strain": "C57BL/6J", "cageId": "C-01", "sex": "female", "..." : "..." },
    "ip": "::ffff:127.0.0.1",
    "userAgent": "curl/7.88.1"
  },
  "response": {
    "status": 201,
    "body": { "id": "ani-5001", "status": "quarantine", "..." : "..." }
  },
  "animalIds": ["ani-5001"]
}
```

**说明**：
- `animalIds`：智能关联，从路径参数、响应体、请求体中提取动物 ID（批量导入自动展开所有子 ID）
- 超大 body（>5KB）自动截断，避免日志膨胀
- 持久化文件：`data/audit-logs.json`

### 审计查询接口（仅 admin）

#### GET /audit/logs — 多条件筛选查询

**查询参数**（均可组合）：

| 参数           | 说明                                    |
| -------------- | --------------------------------------- |
| `animalId`     | 按关联动物 ID 筛选                      |
| `operatorKey`  | 按操作者 API Key 筛选                   |
| `operatorName` | 按操作者姓名模糊筛选                    |
| `role`         | 按操作者角色筛选 (admin/keeper/readonly)|
| `operation`    | 按操作类型筛选，如 `animal.create`      |
| `method`       | 按 HTTP 方法筛选                        |
| `fromDate`     | 时间下限（YYYY-MM-DD）                  |
| `toDate`       | 时间上限（YYYY-MM-DD）                  |
| `statusCode`   | 按响应状态码筛选                        |
| `limit`        | 分页大小，默认 100                      |
| `offset`       | 分页偏移，默认 0                        |

响应：
```json
{
  "total": 42,
  "limit": 100,
  "offset": 0,
  "logs": [ { "id": "audit-42", "..." : "..." } ]
}
```

**查询示例**：
```bash
# 按动物ID查询所有相关操作
curl -H "X-API-Key: admin-key-demo-001" \
  "http://localhost:3007/audit/logs?animalId=ani-1001"

# 按操作者Key查询（饲养员-林青的所有操作）
curl -H "X-API-Key: admin-key-demo-001" \
  "http://localhost:3007/audit/logs?operatorKey=keeper-key-demo-001"

# 查询2026年7月所有动物移出
curl -H "X-API-Key: admin-key-demo-001" \
  "http://localhost:3007/audit/logs?operation=animal.remove&fromDate=2026-07-01&toDate=2026-07-31"
```

#### GET /audit/logs/:id — 单条审计详情

不存在返回 `404 audit_log_not_found`

#### GET /audit/stats — 审计统计汇总

响应：
```json
{
  "total": 128,
  "byOperation": {
    "animal.create": 20,
    "animal.add_note": 35,
    "feeding.checkin": 48,
    "health.event_create": 25
  },
  "byOperator": {
    "饲养员-林青": 75,
    "饲养员-周遥": 53
  },
  "byStatus": { "200": 95, "201": 28, "422": 5 },
  "topAnimals": [
    { "animalId": "ani-1001", "count": 12 },
    { "animalId": "ani-1004", "count": 8 }
  ]
}
```

#### GET /audit/operations — 操作类型枚举

返回所有 `AUDIT_OPERATIONS` 常量，供前端下拉选择。

---

## 中间件链（请求处理流程）

```
Request → 数据库初始化
        → 免认证旁路 (/healthz, /_ping)
        → wrapResponseForAudit (猴子补丁拦截响应)
        → authenticate (401 失败即返回)
        → authorize    (403 失败即返回)
        → 非GET请求读取 body 并缓存
        → 路由处理 (cage→feeding→animal→breeding→health→audit)
        → finally: setImmediate 异步写审计日志 → Response
```

关键点：
- **无框架**：纯 Node `http.createServer`，线性流程无中间件库
- **Body 缓存**：`helpers.body(req)` 带 `_bodyCache`，server 与 handler 共享一次流式消费
- **响应拦截**：包装 `res.writeHead` / `res.end` 捕获状态码和响应体，供审计使用
- **异步审计**：`setImmediate` + 独立 `writeAuditLog` 不阻塞响应返回

---

## 最小验证脚本

```bash
node scripts/test-auth-audit.js
```

覆盖 12 项最小验证：
1. 无 Key → 401
2. 无效 Key → 401
3. readonly 写动物 → 403
4. keeper 新增笼位（admin 操作）→ 403
5. admin 新增笼位 → 成功
6. keeper 动物建档 → 201 + 自动关联 animalId
7. 按动物 ID 查询审计日志 → 命中
8. 按操作者 Key 查询审计日志 → 命中
9. readonly 访问 /audit/stats → 403
10. keeper 访问 /audit/stats → 403
11. admin 访问 /audit/stats → 200（含 total 字段）
12. keeper 访问 /audit/operations → 403；admin 访问 /audit/operations → 200（含 operations 枚举）

启动时自动清理 `data/lab.json` 和 `data/audit-logs.json`，使用独立端口 3099 不影响开发环境。

