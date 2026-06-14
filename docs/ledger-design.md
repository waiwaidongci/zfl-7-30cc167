# 可追溯历史账本模块 - 设计文档

## 概述

可追溯历史账本模块为实验动物管理系统提供事件溯源（Event Sourcing）能力，确保动物的所有关键变更都被记录为不可篡改的事件日志，同时保持与现有 `data/lab.json` 快照的兼容性。

## 设计目标

1. **不可篡改性**：事件日志采用 append-only 模式，通过 SHA-256 校验和链确保完整性
2. **完全兼容**：继续使用 `data/lab.json` 作为当前状态快照，不破坏现有接口
3. **双向一致性**：提供快照与事件日志的一致性校验机制
4. **可追溯性**：支持按动物回放生命周期、按时间范围导出变更
5. **透明迁移**：服务启动时自动从现有快照生成初始事件日志

## 数据模型

### 事件（Event）结构

```json
{
  "id": "evt-1",
  "eventType": "animal.created",
  "animalId": "ani-1001",
  "timestamp": "2026-06-14T10:30:00.000Z",
  "operator": {
    "role": "keeper",
    "name": "林青",
    "key": "api-key-hash"
  },
  "payload": {
    "id": "ani-1001",
    "strain": "C57BL/6J",
    "cageId": "A-01",
    "sex": "female",
    "birthDate": "2026-01-20"
  },
  "snapshotAfter": {
    "id": "ani-1001",
    "status": "quarantine",
    "cageId": "A-01",
    "notesCount": 0,
    "movesCount": 0
  },
  "previousChecksum": "sha256-of-previous-event",
  "checksum": "sha256-of-this-event",
  "metadata": {
    "source": "api",
    "requestId": "uuid"
  }
}
```

### 事件类型

| 事件类型 | 说明 | 触发时机 |
|---------|------|---------|
| `animal.created` | 动物建档 | POST /animals |
| `animal.note_added` | 添加饲养记录 | POST /animals/:id/notes |
| `animal.moved` | 移笼 | POST /animals/:id/move |
| `animal.removed` | 移出 | POST /animals/:id/remove |
| `animal.quarantine_record` | 检疫记录 | POST /animals/:id/quarantine/record |
| `animal.quarantine_released` | 检疫放行 | POST /animals/:id/quarantine/release |
| `animal.quarantine_abnormal` | 检疫异常标记 | POST /animals/:id/quarantine/abnormal |
| `animal.quarantine_resolved` | 检疫异常解除 | POST /animals/:id/quarantine/resolve |
| `animal.batch_imported` | 批量导入 | POST /animals/import |
| `feeding.recorded` | 饲喂记录 | POST /feeding/checkin |
| `breeding.pair_created` | 繁育配对 | POST /breeding/pairs |
| `breeding.litter_weaned` | 断奶分笼 | POST /breeding/litters/:id/wean |
| `ledger.initialized` | 账本初始化 | 首次迁移 |
| `ledger.migrated_from_snapshot` | 从快照迁移完成 | 迁移完成 |

### 存储结构

- **主账本**：`data/event-ledger.json`
  ```json
  {
    "events": [...],
    "nextId": 100,
    "migratedFromSnapshot": true,
    "checksumChain": ["sha256-1", "sha256-2", ...]
  }
  ```

- **快照**：`data/lab.json`（现有结构不变）

## 核心机制

### 1. 双写模式（Dual Write）

所有写操作同时更新：
1. **快照**（`data/lab.json`）- 用于快速查询当前状态
2. **事件日志**（`data/event-ledger.json`）- 用于追溯历史

**执行顺序**：
```
1. 更新内存中的快照数据
2. 追加事件到事件日志（带校验和）
3. 持久化快照到磁盘
4. 持久化事件日志到磁盘
```

### 2. 校验和链（Checksum Chain）

每个事件包含：
- `previousChecksum`：前一个事件的 SHA-256 哈希
- `checksum`：当前事件的 SHA-256 哈希

计算方式：
```javascript
checksum = SHA256(JSON.stringify({
  id, eventType, animalId, timestamp, payload, snapshotAfter
}))
```

`checksumChain` 数组单独存储所有校验和，用于快速验证链的完整性。

### 3. 启动迁移流程

服务启动时：
```
1. 检查 event-ledger.json 是否存在
2. 不存在 → 从 lab.json 生成初始事件日志
   a. 为每只动物重建生命周期事件
   b. 按时间戳排序所有事件
   c. 计算校验和链并持久化
3. 存在 → 加载并验证账本状态
4. 标记迁移完成状态
```

### 4. 快照回放

通过按时间顺序重放事件，可以重建任意时间点的动物状态：

```
初始状态 → 事件1 → 状态1 → 事件2 → 状态2 → ... → 当前状态
```

每个事件都包含 `snapshotAfter` 字段，存储该事件后的关键状态摘要。

## API 接口

详见 [ledger-api.md](./ledger-api.md)

## 权限控制

| 接口 | 所需角色 |
|------|---------|
| GET /ledger/info | READONLY, KEEPER, ADMIN |
| GET /ledger/event-types | READONLY, KEEPER, ADMIN |
| GET /ledger/events | READONLY, KEEPER, ADMIN |
| GET /ledger/events/:id | READONLY, KEEPER, ADMIN |
| GET /ledger/animals/:id/lifecycle | READONLY, KEEPER, ADMIN |
| GET /ledger/export | ADMIN |
| GET /ledger/verify/integrity | ADMIN |
| GET /ledger/verify/snapshot | ADMIN |
| POST /ledger/migrate | ADMIN |

## 完整性验证

### 1. 账本自校验（verifyIntegrity）

验证内容：
- 校验和链长度与事件数量一致
- 每个事件的 `previousChecksum` 与前一事件的 `checksum` 匹配
- 每个事件的 `checksum` 计算正确
- `checksumChain` 数组与事件校验和一致

### 2. 快照一致性校验（verifySnapshotConsistency）

验证内容：
- 所有存在于事件日志中的动物在快照中存在
- 所有存在于快照中的动物在事件日志中有记录
- 关键状态字段（status, cageId, keeper, counts）匹配

## 文件结构

```
lib/
  ├── eventLedger.js          # 核心账本数据层
routes/
  └── ledgerRoutes.js         # 账本 API 路由
scripts/
  ├── migrate-events.js       # 快照迁移脚本
  └── test-ledger.js          # 集成测试套件
docs/
  ├── ledger-design.md        # 本文档
  └── ledger-api.md           # API 文档
data/
  ├── lab.json                # 现有快照（不变）
  └── event-ledger.json       # 新增事件账本
```

## 与现有审计日志的区别

| 特性 | 审计日志（audit-logs.json） | 事件账本（event-ledger.json） |
|------|---------------------------|-----------------------------|
| 目的 | 记录 API 调用操作 | 记录实体状态变更 |
| 粒度 | HTTP 请求级别 | 业务实体级别 |
| 不可篡改性 | 无 | SHA-256 校验和链 |
| 快照支持 | 无 | 每个事件包含变更后快照 |
| 回放能力 | 无 | 支持生命周期回放 |
| 一致性校验 | 无 | 支持与快照双向校验 |
| 数据保留 | 全部保留 | 全部保留 |

## 故障恢复

### 场景1：事件日志损坏但快照完好

```bash
# 重置并重新迁移
rm data/event-ledger.json
npm start  # 服务启动时自动重新迁移
```

### 场景2：快照损坏但事件日志完好

```javascript
// 通过回放事件重建快照（待实现）
const snapshot = await rebuildSnapshotFromEvents();
await saveDb(snapshot);
```

## 性能考虑

- **写入性能**：追加事件为 O(1) 操作，校验和计算可忽略
- **查询性能**：事件查询支持按 animalId 过滤，可考虑后续添加索引
- **存储增长**：每只动物约 10-50 个事件，每个事件约 500B，1万只动物约 5-25MB
- **批量操作**：`recordEventsBatch` 支持批量写入，减少磁盘 I/O
