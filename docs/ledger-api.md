# 可追溯历史账本模块 - API 文档

## 基础信息

- Base URL: `http://localhost:3000`
- 认证: 通过 `X-API-Key` 请求头传递 API Key
- 数据格式: JSON

## 通用响应格式

```json
{
  "success": true,
  "data": { ... },
  "message": "操作成功"
}
```

错误响应:
```json
{
  "success": false,
  "error": "错误原因",
  "message": "详细错误信息"
}
```

---

## 1. 账本统计信息

**GET** `/ledger/info`

获取账本的基本统计信息。

### 响应示例

```json
{
  "success": true,
  "data": {
    "totalEvents": 156,
    "uniqueAnimals": 32,
    "eventTypeCounts": {
      "animal.created": 32,
      "animal.note_added": 45,
      "animal.moved": 12,
      "feeding.recorded": 38,
      "ledger.initialized": 1,
      "ledger.migrated_from_snapshot": 1
    },
    "firstEventTimestamp": "2026-01-20T10:00:00.000Z",
    "lastEventTimestamp": "2026-06-14T15:30:00.000Z",
    "migratedFromSnapshot": true,
    "chainLength": 156
  }
}
```

### 权限要求
- READONLY, KEEPER, ADMIN

---

## 2. 事件类型列表

**GET** `/ledger/event-types`

获取所有支持的事件类型及其说明。

### 响应示例

```json
{
  "success": true,
  "data": [
    { "type": "animal.created", "description": "动物建档" },
    { "type": "animal.note_added", "description": "添加饲养记录" },
    { "type": "animal.moved", "description": "移笼" },
    { "type": "animal.removed", "description": "移出" },
    { "type": "animal.quarantine_record", "description": "检疫记录" },
    { "type": "animal.quarantine_released", "description": "检疫放行" },
    { "type": "animal.quarantine_abnormal", "description": "检疫异常标记" },
    { "type": "animal.quarantine_resolved", "description": "检疫异常解除" },
    { "type": "animal.batch_imported", "description": "批量导入" },
    { "type": "feeding.recorded", "description": "饲喂记录" },
    { "type": "breeding.pair_created", "description": "繁育配对" },
    { "type": "breeding.litter_weaned", "description": "断奶分笼" },
    { "type": "ledger.initialized", "description": "账本初始化" },
    { "type": "ledger.migrated_from_snapshot", "description": "从快照迁移完成" }
  ]
}
```

### 权限要求
- READONLY, KEEPER, ADMIN

---

## 3. 查询事件列表

**GET** `/ledger/events`

支持多维度过滤和分页查询事件。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `eventType` | string/array | 否 | 按事件类型过滤，可传多个（如 `eventType=animal.created&eventType=animal.moved`） |
| `animalId` | string | 否 | 按动物ID过滤 |
| `operatorRole` | string | 否 | 按操作人角色过滤 |
| `operatorName` | string | 否 | 按操作人姓名过滤 |
| `fromDate` | string | 否 | 开始时间，ISO 8601 格式（如 `2026-01-01T00:00:00.000Z`） |
| `toDate` | string | 否 | 结束时间，ISO 8601 格式 |
| `animalRelated` | boolean | 否 | 只返回与动物相关的事件（排除账本系统事件） |
| `sort` | string | 否 | 排序方式，`desc`（默认，最新在前）或 `asc` |
| `limit` | number | 否 | 每页数量，默认 20，最大 100 |
| `offset` | number | 否 | 分页偏移量，默认 0 |

### 响应示例

```json
{
  "success": true,
  "data": {
    "events": [
      {
        "id": "evt-156",
        "eventType": "animal.moved",
        "animalId": "ani-1001",
        "timestamp": "2026-06-14T15:30:00.000Z",
        "operator": {
          "role": "keeper",
          "name": "林青"
        },
        "payload": {
          "fromCage": "A-01",
          "toCage": "B-02",
          "reason": "分组实验"
        },
        "snapshotAfter": {
          "id": "ani-1001",
          "status": "normal",
          "cageId": "B-02",
          "movesCount": 3
        }
      }
    ],
    "total": 156,
    "filtered": 12,
    "limit": 20,
    "offset": 0,
    "sort": "desc"
  }
}
```

### 权限要求
- READONLY, KEEPER, ADMIN

---

## 4. 获取单个事件详情

**GET** `/ledger/events/:id`

获取指定事件的完整详情，包括校验和信息。

### 路径参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 事件ID（如 `evt-156`） |

### 响应示例

```json
{
  "success": true,
  "data": {
    "id": "evt-156",
    "eventType": "animal.moved",
    "animalId": "ani-1001",
    "timestamp": "2026-06-14T15:30:00.000Z",
    "operator": {
      "role": "keeper",
      "name": "林青",
      "key": "xxx"
    },
    "payload": {
      "fromCage": "A-01",
      "toCage": "B-02",
      "reason": "分组实验"
    },
    "snapshotAfter": {
      "id": "ani-1001",
      "status": "normal",
      "cageId": "B-02",
      "movesCount": 3
    },
    "previousChecksum": "sha256-abc123...",
    "checksum": "sha256-def456...",
    "metadata": {
      "source": "api"
    }
  }
}
```

### 权限要求
- READONLY, KEEPER, ADMIN

---

## 5. 回放动物生命周期

**GET** `/ledger/animals/:id/lifecycle`

按时间顺序重放动物的所有事件，展示完整的生命周期轨迹。

### 路径参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 动物ID（如 `ani-1001`） |

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `until` | string | 否 | 重放到指定时间点（ISO 8601 格式），用于查看历史状态 |

### 响应示例

```json
{
  "success": true,
  "data": {
    "animalId": "ani-1001",
    "found": true,
    "totalEvents": 7,
    "filteredEvents": 7,
    "events": [
      {
        "timestamp": "2026-01-20T10:00:00.000Z",
        "eventType": "animal.created",
        "description": "动物建档",
        "payload": { ... },
        "snapshotAfter": { ... }
      }
    ],
    "snapshots": [
      {
        "timestamp": "2026-01-20T10:00:00.000Z",
        "eventType": "animal.created",
        "status": "quarantine",
        "cageId": "A-01",
        "summary": "建档，品系 C57BL/6J，性别 female"
      }
    ],
    "finalSnapshot": {
      "id": "ani-1001",
      "strain": "C57BL/6J",
      "sex": "female",
      "birthDate": "2026-01-20",
      "status": "normal",
      "cageId": "B-02",
      "project": "免疫实验",
      "keeper": "林青",
      "notesCount": 3,
      "movesCount": 3
    },
    "until": null
  }
}
```

### 权限要求
- READONLY, KEEPER, ADMIN

---

## 6. 按时间范围导出变更

**GET** `/ledger/export`

按时间范围导出事件，支持 JSON 和 CSV 格式。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fromDate` | string | 是 | 开始时间，ISO 8601 格式 |
| `toDate` | string | 是 | 结束时间，ISO 8601 格式 |
| `format` | string | 否 | 导出格式，`json`（默认）或 `csv` |
| `animalId` | string | 否 | 按动物ID过滤 |
| `eventTypes` | string/array | 否 | 按事件类型过滤 |

### 响应示例 (JSON)

```json
{
  "success": true,
  "data": {
    "format": "json",
    "fromDate": "2026-01-01T00:00:00.000Z",
    "toDate": "2026-06-30T23:59:59.999Z",
    "total": 42,
    "generatedAt": "2026-06-14T16:00:00.000Z",
    "events": [ ... ]
  }
}
```

### 响应示例 (CSV)

```
event_id,event_type,animal_id,timestamp,operator_role,operator_name,payload_summary
evt-1,animal.created,ani-1001,2026-01-20T10:00:00.000Z,keeper,林青,建档: C57BL/6J
evt-2,animal.moved,ani-1001,2026-03-15T14:30:00.000Z,keeper,林青,移笼: A-01 → B-02
```

### 权限要求
- ADMIN

---

## 7. 校验事件日志完整性

**GET** `/ledger/verify/integrity`

校验事件日志的校验和链完整性，检测是否被篡改。

### 响应示例

```json
{
  "success": true,
  "data": {
    "valid": true,
    "totalEvents": 156,
    "checked": 156,
    "errors": [],
    "firstEvent": {
      "id": "evt-1",
      "timestamp": "2026-01-20T10:00:00.000Z",
      "checksum": "sha256-abc123..."
    },
    "lastEvent": {
      "id": "evt-156",
      "timestamp": "2026-06-14T15:30:00.000Z",
      "checksum": "sha256-xyz789..."
    },
    "chainVerified": true
  }
}
```

### 错误示例

```json
{
  "success": true,
  "data": {
    "valid": false,
    "totalEvents": 156,
    "checked": 45,
    "errors": [
      {
        "eventId": "evt-45",
        "type": "checksum_mismatch",
        "message": "Event checksum does not match calculated value"
      },
      {
        "eventId": "evt-46",
        "type": "previous_checksum_mismatch",
        "message": "Previous checksum reference does not match previous event"
      }
    ],
    "firstEvent": { ... },
    "lastEvent": { ... },
    "chainVerified": false
  }
}
```

### 权限要求
- ADMIN

---

## 8. 校验快照与事件一致性

**GET** `/ledger/verify/snapshot`

校验事件日志重放结果与当前快照（`lab.json`）是否一致。

### 响应示例

```json
{
  "success": true,
  "data": {
    "consistent": true,
    "totalAnimalsInLedger": 32,
    "totalAnimalsInSnapshot": 32,
    "totalChecked": 32,
    "totalPassed": 32,
    "totalFailed": 0,
    "errors": [],
    "checkedAt": "2026-06-14T16:00:00.000Z"
  }
}
```

### 错误示例

```json
{
  "success": true,
  "data": {
    "consistent": false,
    "totalAnimalsInLedger": 32,
    "totalAnimalsInSnapshot": 32,
    "totalChecked": 32,
    "totalPassed": 31,
    "totalFailed": 1,
    "errors": [
      {
        "animalId": "ani-1005",
        "type": "field_mismatch",
        "field": "status",
        "snapshotValue": "normal",
        "ledgerValue": "quarantine",
        "message": "Field 'status' mismatch: snapshot='normal', ledger='quarantine'"
      }
    ],
    "checkedAt": "2026-06-14T16:00:00.000Z"
  }
}
```

### 权限要求
- ADMIN

---

## 9. 执行快照迁移

**POST** `/ledger/migrate`

从当前 `lab.json` 快照生成初始事件日志。

### 查询参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `force` | boolean | 否 | 强制重新迁移，即使账本已存在（将重置账本） |

### 请求示例

```http
POST /ledger/migrate?force=true
X-API-Key: admin-key
```

### 响应示例

```json
{
  "success": true,
  "data": {
    "migrated": true,
    "force": true,
    "totalAnimals": 32,
    "totalEvents": 154,
    "byEventType": {
      "animal.created": 32,
      "animal.note_added": 45,
      "animal.moved": 12,
      "animal.quarantine_record": 28,
      "animal.quarantine_released": 18,
      "feeding.recorded": 19
    },
    "operator": {
      "role": "admin",
      "name": "管理员",
      "key": "api-key"
    },
    "durationMs": 1256
  }
}
```

### 权限要求
- ADMIN

---

## 错误码说明

| HTTP 状态码 | 错误码 | 说明 |
|------------|--------|------|
| 400 | `invalid_date` | 日期格式无效 |
| 400 | `invalid_event_type` | 事件类型无效 |
| 400 | `missing_required_parameter` | 缺少必填参数 |
| 403 | `forbidden` | 权限不足 |
| 404 | `event_not_found` | 事件不存在 |
| 404 | `animal_not_found` | 动物不存在 |
| 409 | `ledger_already_exists` | 账本已存在（迁移时需要 force=true） |
| 500 | `internal_error` | 服务器内部错误 |

---

## 示例代码

### 使用 curl 查询事件列表

```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:3000/ledger/events?animalId=ani-1001&sort=asc"
```

### 使用 curl 回放动物生命周期

```bash
curl -H "X-API-Key: your-api-key" \
  "http://localhost:3000/ledger/animals/ani-1001/lifecycle"
```

### 使用 curl 校验完整性

```bash
curl -H "X-API-Key: admin-key" \
  "http://localhost:3000/ledger/verify/integrity"
```

### 使用 curl 导出 CSV

```bash
curl -H "X-API-Key: admin-key" \
  "http://localhost:3000/ledger/export?fromDate=2026-01-01T00:00:00.000Z&toDate=2026-06-30T23:59:59.999Z&format=csv" \
  > events-export.csv
```
