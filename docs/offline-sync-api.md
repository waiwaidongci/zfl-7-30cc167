# 离线巡检同步 API

## 概述

本模块支持饲养员在移动端离线采集饲养记录后批量同步到服务端。主要功能：

- **幂等性保证**：每个操作携带客户端生成的 `operationId`，重复提交不重复写入
- **冲突检测**：同一动物同一天多端提交冲突时返回可解释的冲突结果
- **字段级合并**：按策略（默认 `merge_non_conflict`）自动合并非冲突字段
- **批量处理**：支持一次最多 100 条操作的批量同步
- **多种操作类型**：饲养记录/体重、动物移笼、饲喂打卡、笼位异常上报

## 端点列表

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/sync/meta` | 只读以上 | 获取同步接口元信息 |
| POST | `/sync/batch` | 饲养员以上 | 批量提交离线采集操作 |
| GET | `/sync/operations` | 只读以上 | 查询同步操作历史 |
| GET | `/sync/operations/:id` | 只读以上 | 查询单个同步操作详情 |
| GET | `/sync/cage-abnormal` | 只读以上 | 查询笼位异常上报记录 |

## 数据模型

### 操作类型 (operationType)

- `animal_note` - 动物饲养记录（含体重、状况描述、照片占位）
- `animal_move` - 动物移笼
- `feeding_record` - 饲喂打卡记录
- `cage_abnormal` - 笼位异常上报

### 冲突策略 (conflictStrategy)

| 策略 | 说明 |
|------|------|
| `merge_non_conflict` | **默认**，自动合并非冲突字段，冲突字段保留服务端数据，返回 partial 状态 |
| `server_wins` | 冲突字段全部采用服务端，仅写入客户端独有非空字段 |
| `client_wins` | 冲突字段全部采用客户端，覆盖服务端数据 |
| `reject` | 存在任何冲突即拒绝写入，返回 conflict 状态 |

### 操作状态 (status)

| 状态 | 说明 |
|------|------|
| `applied` | 成功写入，无冲突 |
| `duplicate` | operationId 重复，未重复写入 |
| `partial` | 部分字段合并成功，仍有冲突字段待人工处理 |
| `conflict` | 检测到冲突，按策略未写入 |
| `error` | 验证失败或执行出错 |

## POST /sync/batch — 批量同步

### 请求体格式

```json
{
  "operations": [
    {
      "operationId": "uuid-v4-client-generated",
      "operationType": "animal_note",
      "keeper": "林青",
      "deviceId": "mobile-device-001",
      "clientCreatedAt": "2026-06-15T08:30:00.000Z",
      "conflictStrategy": "merge_non_conflict",
      "payload": {
        "animalId": "ani-1001",
        "date": "2026-06-15",
        "weight": 21.5,
        "condition": "食欲良好，毛色顺滑",
        "type": "general",
        "photoPlaceholders": [
          {
            "localPath": "/sdcard/photos/ani-1001-1.jpg",
            "size": 2458321,
            "takenAt": "2026-06-15T08:28:00.000Z",
            "hash": "sha256:abc123def..."
          }
        ]
      }
    }
  ]
}
```

### 各操作类型 payload 字段

#### animal_note

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `animalId` | string | 是 | 动物ID |
| `date` | string | 否 | 记录日期 YYYY-MM-DD，默认取 clientCreatedAt 日期 |
| `weight` | number | 否 | 体重（克） |
| `condition` | string | 否 | 状况描述 |
| `type` | string | 否 | 记录类型，默认 general |
| `photoPlaceholders` | array | 否 | 照片占位信息数组 |

#### animal_move

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `animalId` | string | 是 | 动物ID |
| `cageId` | string | 是 | 目标笼位ID |
| `reason` | string | 否 | 移笼原因 |
| `date` | string | 否 | 移笼日期 |

#### feeding_record

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `targetType` | string | 是 | `animal` 或 `cage` |
| `targetId` | string | 是 | 动物ID或笼位ID |
| `feedType` | string | 是 | 饲料类型 |
| `amount` | number | 否 | 投喂量 |
| `keeper` | string | 是 | 饲养员 |
| `date` | string | 否 | 饲喂日期 |
| `condition` | string | 否 | 进食情况观察 |
| `weight` | number | 否 | 同步体重测量 |
| `notes` | string | 否 | 备注 |
| `photoPlaceholders` | array | 否 | 照片占位信息 |

#### cage_abnormal

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `cageId` | string | 是 | 笼位ID |
| `abnormalType` | string | 否 | 异常类型：`water_leak`/`feed_contamination`/`equipment_failure`/`temperature`/`hygiene`/`other`，默认 other |
| `severity` | string | 否 | 严重程度：`minor`/`normal`/`critical`，默认 normal |
| `description` | string | 否 | 异常描述 |
| `date` | string | 否 | 发现日期 |
| `notes` | string | 否 | 备注 |
| `photoPlaceholders` | array | 否 | 照片占位信息 |

### 响应格式

```json
{
  "summary": {
    "total": 3,
    "applied": 1,
    "duplicates": 1,
    "conflicts": 0,
    "errors": 0,
    "partial": 1
  },
  "results": [
    {
      "operationId": "op-001-applied",
      "operationType": "animal_note",
      "status": "applied",
      "data": {
        "note": {
          "id": "note-xxx",
          "date": "2026-06-15",
          "weight": 21.5,
          "condition": "食欲良好",
          "keeper": "林青"
        },
        "healthEvent": {
          "created": false,
          "merged": false,
          "eventId": null
        }
      },
      "conflict": null,
      "error": null,
      "mergedFields": null
    },
    {
      "operationId": "op-002-duplicate",
      "operationType": "animal_move",
      "status": "duplicate",
      "data": { ... 上次写入的结果 ... },
      "conflict": null,
      "error": null,
      "mergedFields": null
    },
    {
      "operationId": "op-003-partial",
      "operationType": "animal_note",
      "status": "partial",
      "data": { ... 合并后写入的数据 ... },
      "conflict": {
        "incomingOperationId": "op-003-partial",
        "existingOperationId": "op-server-existing",
        "existingKeeper": "周遥",
        "existingSubmittedAt": "2026-06-15T07:00:00.000Z",
        "existingClientCreatedAt": "2026-06-15T06:55:00.000Z",
        "operationType": "animal_note",
        "date": "2026-06-15",
        "animalId": "ani-1001",
        "cageId": null,
        "conflictingFields": [
          {
            "field": "weight",
            "clientValue": 21.5,
            "serverValue": 21.8
          }
        ],
        "nonConflictingFields": [
          {
            "field": "condition",
            "clientValue": "食欲良好",
            "serverValue": null
          }
        ],
        "explanation": "同一饲养记录/体重在当天已有服务端记录，存在 1 个字段冲突；冲突字段：weight；1 个非冲突字段可自动合并"
      },
      "error": null,
      "mergedFields": ["condition"]
    }
  ]
}
```

### HTTP 状态码

- `200` - 全部或部分操作成功（含 duplicate 状态）
- `400` - 请求格式错误或批次为空或超限
- `409` - 存在冲突且无任何操作被成功写入
- `422` - 全部操作均因验证或执行失败

## 使用示例

### 示例 1：基础同步（含幂等重试）

```bash
curl -X POST http://localhost:3007/sync/batch \
  -H "X-API-Key: <keeper-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [
      {
        "operationId": "note-ani1001-20260615-" + Date.now(),
        "operationType": "animal_note",
        "keeper": "林青",
        "deviceId": "pad-001",
        "clientCreatedAt": "2026-06-15T08:30:00.000Z",
        "payload": {
          "animalId": "ani-1001",
          "date": "2026-06-15",
          "weight": 21.4,
          "condition": "正常进食，活动自如"
        }
      }
    ]
  }'
```

### 示例 2：多类型混合批量同步

```json
{
  "operations": [
    {
      "operationId": "note-uuid-1",
      "operationType": "animal_note",
      "keeper": "林青",
      "clientCreatedAt": "2026-06-15T08:00:00.000Z",
      "payload": {
        "animalId": "ani-1001",
        "date": "2026-06-15",
        "weight": 21.5,
        "condition": "体重稳定",
        "photoPlaceholders": [
          { "localPath": "img1.jpg", "size": 1024000, "takenAt": "2026-06-15T07:58:00.000Z", "hash": "sha256:a1b2c3" }
        ]
      }
    },
    {
      "operationId": "move-uuid-2",
      "operationType": "animal_move",
      "keeper": "林青",
      "clientCreatedAt": "2026-06-15T08:10:00.000Z",
      "payload": {
        "animalId": "ani-1002",
        "cageId": "A-02",
        "reason": "实验分组调整"
      }
    },
    {
      "operationId": "feed-uuid-3",
      "operationType": "feeding_record",
      "keeper": "林青",
      "clientCreatedAt": "2026-06-15T08:15:00.000Z",
      "payload": {
        "targetType": "animal",
        "targetId": "ani-1001",
        "feedType": "标准颗粒饲料",
        "amount": 2.5,
        "condition": "全部吃完"
      }
    },
    {
      "operationId": "cage-uuid-4",
      "operationType": "cage_abnormal",
      "keeper": "林青",
      "clientCreatedAt": "2026-06-15T08:20:00.000Z",
      "payload": {
        "cageId": "B-03",
        "abnormalType": "water_leak",
        "severity": "normal",
        "description": "饮水嘴轻微漏水，已通知维修",
        "photoPlaceholders": [
          { "localPath": "cage-leak.jpg", "size": 2048000, "takenAt": "2026-06-15T08:19:00.000Z", "hash": "sha256:d4e5f6" }
        ]
      }
    }
  ]
}
```

### 示例 3：使用 client_wins 策略强制覆盖冲突

```bash
curl -X POST http://localhost:3007/sync/batch \
  -H "X-API-Key: <keeper-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "operations": [
      {
        "operationId": "force-overwrite-" + Date.now(),
        "operationType": "animal_note",
        "keeper": "林青",
        "clientCreatedAt": "2026-06-15T09:00:00.000Z",
        "conflictStrategy": "client_wins",
        "payload": {
          "animalId": "ani-1001",
          "date": "2026-06-15",
          "weight": 21.6,
          "condition": "经复检确认修正体重数据"
        }
      }
    ]
  }'
```

## 客户端实现建议

1. **operationId 生成**：使用 UUID v4，在离线采集创建记录时生成，客户端永久保存
2. **重试机制**：网络失败时使用相同 operationId 重试，服务端保证幂等
3. **冲突处理**：
   - 默认使用 `merge_non_conflict`，自动合并非冲突字段
   - 对 status=partial 的操作，提示用户查看冲突字段并人工确认
   - 用户确认后可使用 `client_wins` 策略重新提交（需生成新 operationId）
4. **照片管理**：photoPlaceholders 仅存储元信息，照片文件使用独立上传接口同步
5. **批次大小**：单次提交建议不超过 50 条，最多 100 条

## 查询接口

### GET /sync/operations — 查询同步历史

查询参数：
- `status` - 按状态过滤
- `keeper` - 按饲养员过滤
- `operationType` - 按操作类型过滤
- `fromDate` / `toDate` - 按提交时间范围过滤

### GET /sync/cage-abnormal — 查询笼位异常

查询参数：
- `cageId` / `roomId` - 按笼位/房间过滤
- `status` - 按处理状态过滤
- `severity` - 按严重程度过滤
- `fromDate` / `toDate` - 按日期范围过滤
