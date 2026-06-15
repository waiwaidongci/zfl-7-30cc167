# 饲喂计划与打卡 API 文档

## 概述

饲喂模块支持按动物或笼位设置饲喂计划，并记录每日饲喂完成情况。

## 数据结构

### 饲喂计划 (FeedingPlan)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 计划ID |
| targetType | string | 目标类型：animal / cage |
| targetId | string | 目标ID（动物ID或笼位ID） |
| feedType | string | 饲料类型 |
| feedTimes | string[] | 每日饲喂时间点，如 ["08:00", "18:00"] |
| dailyAmount | number | 每日饲喂总量（克） |
| keeper | string | 负责饲养员 |
| status | string | 状态：active / inactive |
| startDate | string | 生效开始日期（YYYY-MM-DD） |
| endDate | string \| null | 生效结束日期 |
| createdAt | string | 创建时间 |
| notes | string | 备注 |

### 饲喂记录 (FeedingRecord)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 记录ID |
| planId | string | 关联计划ID |
| targetType | string | 目标类型 |
| targetId | string | 目标ID |
| date | string | 饲喂日期（YYYY-MM-DD） |
| scheduledTime | string \| null | 计划饲喂时间 |
| actualTime | string | 实际打卡时间 |
| feedType | string | 饲料类型 |
| amount | number | 实际饲喂量 |
| keeper | string | 实际操作饲养员 |
| status | string | 状态：completed / missed |
| condition | string | 体况描述（用于健康异常检测） |
| weight | number \| null | 当前体重（g，用于体重变化检测） |
| notes | string | 备注 |

---

## 接口列表

### 1. 创建饲喂计划

**POST** `/feeding/plans`

**请求体：**
```json
{
  "targetType": "animal",
  "targetId": "ani-1001",
  "feedType": "标准颗粒饲料",
  "feedTimes": ["08:00", "18:00"],
  "dailyAmount": 5.0,
  "keeper": "林青",
  "startDate": "2026-06-01",
  "endDate": null,
  "notes": "每日两次定量饲喂"
}
```

**响应 201：**
```json
{
  "id": "plan-xxx",
  "targetType": "animal",
  "targetId": "ani-1001",
  "feedType": "标准颗粒饲料",
  "feedTimes": ["08:00", "18:00"],
  "dailyAmount": 5,
  "keeper": "林青",
  "status": "active",
  "startDate": "2026-06-01",
  "endDate": null,
  "createdAt": "2026-06-14T...",
  "notes": "每日两次定量饲喂",
  "feedCount": 2
}
```

### 2. 查询饲喂计划列表

**GET** `/feeding/plans?targetType=&targetId=&status=&keeper=`

**查询参数：**
- `targetType`: 按目标类型筛选（animal / cage）
- `targetId`: 按目标ID筛选
- `status`: 按状态筛选（active / inactive）
- `keeper`: 按饲养员筛选

**响应 200：** 饲喂计划数组

### 3. 查询单个饲喂计划

**GET** `/feeding/plans/:id`

**响应 200：** 饲喂计划对象

**响应 404：**
```json
{ "error": "plan_not_found" }
```

### 4. 停用餐喂计划

**POST** `/feeding/plans/:id/disable`

**响应 200：** 更新后的饲喂计划对象

### 5. 查询今日待饲喂任务

**GET** `/feeding/today?targetType=&keeper=&date=`

**查询参数：**
- `targetType`: 按目标类型筛选
- `keeper`: 按饲养员筛选
- `date`: 指定日期（默认今天）

**响应 200：**
```json
[
  {
    "planId": "plan-1",
    "targetType": "animal",
    "targetId": "ani-1001",
    "feedType": "标准颗粒饲料",
    "scheduledTime": "08:00",
    "keeper": "林青",
    "status": "pending",
    "completedAt": null,
    "recordId": null,
    "date": "2026-06-14"
  }
]
```

### 6. 今日饲喂统计

**GET** `/feeding/today/summary`

**响应 200：**
```json
{
  "date": "2026-06-14",
  "total": 6,
  "completed": 2,
  "pending": 4,
  "completionRate": 33.3,
  "byKeeper": [
    { "keeper": "林青", "total": 4, "completed": 2, "completionRate": 50.0 }
  ]
}
```

### 7. 查询饲喂日程（日期范围）

**GET** `/feeding/schedule?dateFrom=&dateTo=&targetType=&keeper=&roomId=`

**查询参数：**
- `dateFrom`: 起始日期（YYYY-MM-DD），默认今天
- `dateTo`: 结束日期（YYYY-MM-DD），默认今天+6天（共7天），最大范围31天
- `targetType`: 按目标类型筛选（animal / cage）
- `keeper`: 按饲养员筛选
- `roomId`: 按房间筛选

**响应 200：**
```json
{
  "dateFrom": "2026-06-15",
  "dateTo": "2026-06-21",
  "days": 7,
  "filters": {
    "targetType": null,
    "keeper": null,
    "roomId": null
  },
  "overall": {
    "total": 42,
    "completed": 6,
    "pending": 36,
    "overdue": 2,
    "completionRate": 14.3,
    "byKeeper": [
      { "keeper": "林青", "total": 28, "completed": 4, "completionRate": 14.3 }
    ]
  },
  "dailySchedule": [
    {
      "date": "2026-06-15",
      "total": 6,
      "completed": 2,
      "pending": 4,
      "completionRate": 33.3,
      "missedRisk": {
        "level": "medium",
        "reason": "overdue_tasks",
        "pendingCount": 4,
        "overdueCount": 2
      },
      "byKeeper": [
        { "keeper": "林青", "total": 4, "completed": 2, "completionRate": 50.0 }
      ],
      "tasks": [
        {
          "planId": "plan-1",
          "targetType": "animal",
          "targetId": "ani-1001",
          "feedType": "标准颗粒饲料",
          "scheduledTime": "08:00",
          "keeper": "林青",
          "status": "completed",
          "completedAt": "2026-06-15T08:05:00.000Z",
          "recordId": "record-xxx",
          "roomId": "room-main",
          "zoneId": "zone-spf",
          "date": "2026-06-15"
        }
      ]
    }
  ]
}
```

**漏喂风险等级（missedRisk.level）说明：**
- `none`: 无风险（全部完成或无任务）
- `low`: 低风险（未来日期 / 今日任务均未逾期）
- `medium`: 中风险（今日有部分任务逾期，占比 <50%）
- `high`: 高风险（今日超50%任务逾期 / 昨日有未完成任务）
- `critical`: 严重风险（历史日期任务全部未完成）

**响应 400（日期格式/范围错误）：**
```json
{ "error": "range_too_large", "message": "查询范围不能超过31天" }
```

---

### 8. 饲喂日程摘要（日期范围，不含任务明细）

**GET** `/feeding/schedule/summary?dateFrom=&dateTo=&targetType=&keeper=&roomId=`

查询参数与 `/feeding/schedule` 相同，返回结构也相同，区别在于 `dailySchedule` 中只返回统计数据，不包含 `tasks` 数组（用 `taskCount` 代替），用于减少响应体积。

**响应 200 dailySchedule 片段：**
```json
{
  "dailySchedule": [
    {
      "date": "2026-06-15",
      "total": 6,
      "completed": 2,
      "pending": 4,
      "completionRate": 33.3,
      "missedRisk": { "level": "medium", "reason": "overdue_tasks", "pendingCount": 4, "overdueCount": 2 },
      "byKeeper": [{ "keeper": "林青", "total": 4, "completed": 2, "completionRate": 50.0 }],
      "taskCount": 6
    }
  ]
}
```

---

### 9. 提交饲喂打卡

**POST** `/feeding/checkin`

**请求体：**
```json
{
  "planId": "plan-1",
  "scheduledTime": "08:00",
  "amount": 2.5,
  "keeper": "林青",
  "condition": "食欲良好，活动正常",
  "weight": 21.4,
  "notes": "状态稳定"
}
```

**也可直接指定目标：**
```json
{
  "targetType": "animal",
  "targetId": "ani-1001",
  "feedType": "标准颗粒饲料",
  "amount": 2.5,
  "keeper": "林青",
  "condition": "临时饲喂观察",
  "notes": "补充饲喂"
}
```

**请求体字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| planId | string | 条件 | 关联计划ID（与 targetType/targetId 二选一） |
| targetType | string | 条件 | 目标类型：animal / cage（与 planId 二选一） |
| targetId | string | 条件 | 目标ID（与 planId 二选一） |
| feedType | string | 否 | 饲料类型（未指定 planId 时必填） |
| amount | number | 否 | 实际饲喂量（g），默认 0 |
| keeper | string | 是 | 操作饲养员 |
| scheduledTime | string | 否 | 计划饲喂时间 |
| status | string | 否 | 状态：completed / missed，默认 completed |
| **condition** | string | 否 | **体况描述，用于健康异常自动检测** |
| **weight** | number | 否 | **当前体重（g），用于体重变化阈值检测** |
| notes | string | 否 | 备注 |

**响应 201：** 饲喂记录对象。当检测到健康异常时，返回值中会附加 `healthEvents` 数组，包含触发的事件信息。

**异常检测响应示例：**
```json
{
  "id": "record-xxx",
  "planId": "plan-1",
  "targetType": "animal",
  "targetId": "ani-1001",
  "date": "2026-06-14",
  "condition": "食欲下降，精神差",
  "weight": 20.2,
  "notes": "状态不佳",
  "healthEvents": [
    {
      "created": true,
      "merged": false,
      "eventId": "hev-xxx",
      "event": {
        "id": "hev-xxx",
        "animalId": "ani-1001",
        "status": "pending",
        "abnormalKeywords": ["食欲下降", "精神差", "体重异常变化"]
      }
    }
  ]
}
```

### 8. 查询饲喂记录

**GET** `/feeding/records?planId=&targetType=&targetId=&date=&keeper=&status=`

**查询参数：**
- `planId`: 按计划ID筛选
- `targetType`: 按目标类型筛选
- `targetId`: 按目标ID筛选
- `date`: 按日期筛选
- `keeper`: 按饲养员筛选
- `status`: 按状态筛选

**响应 200：** 饲喂记录数组（按时间倒序）

### 9. 查询单条饲喂记录

**GET** `/feeding/records/:id`

**响应 200：** 饲喂记录对象

### 10. 饲喂历史统计

**GET** `/feeding/history?days=7&targetType=&targetId=&keeper=`

**查询参数：**
- `days`: 统计天数（默认7天）
- `targetType`: 按目标类型筛选
- `targetId`: 按目标ID筛选
- `keeper`: 按饲养员筛选

**响应 200：**
```json
{
  "days": 7,
  "totalCompleted": 15,
  "totalTasks": 20,
  "overallCompletionRate": 75.0,
  "dailyStats": [
    {
      "date": "2026-06-14",
      "totalTasks": 6,
      "completed": 4,
      "completionRate": 66.7,
      "records": [...]
    }
  ]
}
```

---

## 使用示例

### 示例1：创建按动物饲喂的计划

```bash
curl -X POST http://localhost:3007/feeding/plans \
  -H "Content-Type: application/json" \
  -d '{
    "targetType": "animal",
    "targetId": "ani-1001",
    "feedType": "标准颗粒饲料",
    "feedTimes": ["08:00", "18:00"],
    "dailyAmount": 5.0,
    "keeper": "林青",
    "notes": "代谢观察组"
  }'
```

### 示例2：查看今日待饲喂任务

```bash
curl http://localhost:3007/feeding/today
```

### 示例3：提交打卡

```bash
curl -X POST http://localhost:3007/feeding/checkin \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "plan-1",
    "scheduledTime": "08:00",
    "amount": 2.5,
    "keeper": "林青",
    "notes": "进食正常"
  }'
```

### 示例4：查看未来7天饲喂日程

```bash
curl "http://localhost:3007/feeding/schedule?dateFrom=2026-06-15&dateTo=2026-06-21"
```

### 示例5：按饲养员和房间筛选日程摘要

```bash
curl "http://localhost:3007/feeding/schedule/summary?keeper=林青&roomId=room-main"
```

### 示例6：查看历史记录

```bash
curl "http://localhost:3007/feeding/history?days=7&keeper=林青"
```
