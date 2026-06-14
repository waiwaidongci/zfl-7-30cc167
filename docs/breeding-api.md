# 繁育管理模块 API 文档

## 概述

繁育管理模块支持实验动物的完整繁育流程：登记配对笼、父母动物、合笼日期、预产观察节点、出生窝仔记录和断奶分笼。断奶时批量生成子代动物，并保留父母来源关系。

**与现有系统的兼容性：**
- 繁育模块新增 `breedingPairs`、`breedingLitters` 顶层数组，不修改现有动物、笼位、饲喂、库存数据结构
- 动物对象仅新增**可选字段** `fatherId`、`motherId`、`litterId`、`breedingInfo`，所有历史动物自动补 null，不影响现有查询、移动、统计
- 笼位容量检查、OCCUPANCY_STATUSES、ACTIVE_STOCK_STATUSES 等原有逻辑完全保留
- `reports/stock`、`reports/upcoming`、动物 CRUD、笼位 CRUD、饲喂模块均不受影响

---

## 数据结构

### 1. 配对记录 (BreedingPair)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 配对记录ID |
| cageId | string | 配对笼ID |
| maleId | string | 父本动物ID（必须已放行雄性） |
| femaleId | string | 母本动物ID（必须已放行雌性） |
| pairDate | string | 合笼日期（YYYY-MM-DD） |
| expectedDeliveryDate | string | 预产期（默认合笼日+21天） |
| observationNodes | string[] | 预产观察节点日期数组 |
| status | string | 配对状态：pending / mated / pregnant / delivered / weaned / cancelled |
| strain | string | 品系（继承自父本） |
| keeper | string | 负责饲养员 |
| notes | string | 备注 |
| createdAt | string | 创建时间 |
| statusUpdatedAt | string | 状态更新时间 |
| cancelledAt | string | 取消时间 |
| cancelReason | string | 取消原因 |
| deliveredAt | string | 确认产仔时间 |
| weanedAt | string | 断奶时间 |

**状态流转：**
```
pending → mated → pregnant → delivered → weaned
                       ↘ cancelled
```

### 2. 窝仔记录 (BreedingLitter)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 窝仔记录ID |
| pairId | string | 关联配对记录ID |
| birthDate | string | 出生日期（YYYY-MM-DD） |
| totalPups | number | 出生总数 |
| malePups | number | 雄性数 |
| femalePups | number | 雌性数 |
| unknownSexPups | number | 未确定性别的数量 |
| status | string | 窝仔状态：born / weaning / weaned |
| cageId | string | 出生所在笼位 |
| keeper | string | 负责饲养员 |
| notes | string | 备注 |
| weanDate | string | 断奶日期 |
| weanedAt | string | 断奶操作时间 |
| weanedCount | number | 实际断量子代数 |
| weaningPlan | object[] | 断奶分笼配置快照 |
| createdAt | string | 创建时间 |
| updatedAt | string | 更新时间 |

### 3. 动物繁育扩展字段（可选，默认null）

动物对象新增字段，不影响已有逻辑：

| 字段 | 类型 | 说明 |
|------|------|------|
| fatherId | string \| null | 父本动物ID |
| motherId | string \| null | 母本动物ID |
| litterId | string \| null | 所属窝仔ID |
| breedingInfo | object \| null | 详细繁育信息：{fatherId, motherId, litterId, pairingId, weanDate, weaningWeight} |
| weanedAt | string \| null | 断奶时间 |
| weaningWeight | number \| null | 断奶体重 |

---

## 接口列表

### 1. 创建配对记录

**POST** `/breeding/pairs`

**请求体：**
```json
{
  "cageId": "A-02",
  "maleId": "ani-2001",
  "femaleId": "ani-2002",
  "pairDate": "2026-06-14",
  "expectedDeliveryDate": "2026-07-05",
  "observationNodes": ["2026-06-21", "2026-06-28"],
  "keeper": "林青",
  "notes": "C57BL/6J 近交系繁育"
}
```

**说明：**
- 若不传 `expectedDeliveryDate`，自动按合笼日+21天计算
- 若不传 `observationNodes`，自动生成里程碑节点（合笼后7/14天，预产期前2/当天/后3天）
- 创建时会自动将父母本动物移动到配对笼（如不在此笼）
- 父本和母本必须是 `released`（已放行）状态，品系一致，且未参与其他活跃配对

**响应 201：** 包含父母摘要、笼位摘要、关联窝仔数的 enriched 配对对象

**响应 400 / 422：** 校验失败，返回 `{ error, details:[{code, field, message}] }`

---

### 2. 查询配对列表

**GET** `/breeding/pairs?cageId=&maleId=&femaleId=&status=&strain=`

**查询参数（均可选）：**
- `cageId`: 按配对笼筛选
- `maleId`: 按父本ID筛选
- `femaleId`: 按母本ID筛选
- `status`: 按状态筛选（pending/mated/pregnant/delivered/weaned/cancelled）
- `strain`: 按品系筛选

**响应 200：** 配对数组（每条含父母/笼位摘要、窝仔统计）

---

### 3. 查询单个配对

**GET** `/breeding/pairs/:id`

**响应 200：** 配对详情 + 关联窝仔精简列表

**响应 404：** `{ "error": "pairing_not_found" }`

---

### 4. 更新配对状态

**POST** `/breeding/pairs/:id/status`

**请求体：**
```json
{
  "status": "pregnant",
  "notes": "见栓确认怀孕"
}
```

**有效状态值：** `pending`、`mated`、`pregnant`、`delivered`、`weaned`、`cancelled`

**响应 200：** 更新后的配对对象

---

### 5. 取消配对

**POST** `/breeding/pairs/:id/cancel`

**请求体（可选）：**
```json
{
  "reason": "未见栓，繁殖力不佳"
}
```

**响应 200：** 标记为 cancelled 的配对对象

---

### 6. 登记出生窝仔

**POST** `/breeding/litters`

**请求体：**
```json
{
  "pairId": "pair-demo-1",
  "birthDate": "2026-06-10",
  "totalPups": 8,
  "malePups": 4,
  "femalePups": 3,
  "notes": "出生8只，发育良好",
  "keeper": "林青"
}
```

**说明：**
- `malePups + femalePups <= totalPups`，差值记入 `unknownSexPups`
- 自动将关联配对状态推进为 `delivered`
- 出生日期不能早于合笼日期

**响应 201：** 窝仔详情（含父母摘要）

---

### 7. 查询窝仔列表

**GET** `/breeding/litters?pairId=&status=`

**查询参数：**
- `pairId`: 按配对ID筛选
- `status`: 按状态筛选（born/weaning/weaned）

**响应 200：** 窝仔数组（含父/母ID、已断量子代ID列表）

---

### 8. 查询单个窝仔

**GET** `/breeding/litters/:id`

**响应 200：** 窝仔详情

---

### 9. 更新窝仔信息

**POST** `/breeding/litters/:id/update`

**请求体（只传需修改字段）：**
```json
{
  "malePups": 5,
  "femalePups": 3,
  "notes": "计数更正，总数不变"
}
```

**可更新字段：** `totalPups`、`malePups`、`femalePups`、`notes`、`status`

**响应 200：** 更新后的窝仔对象

---

### 10. 断奶分笼并批量生成子代

**POST** `/breeding/litters/:id/wean`

**请求体：**
```json
{
  "weanDate": "2026-07-01",
  "offspring": [
    {
      "sex": "male",
      "count": 4,
      "cageId": "A-02",
      "project": "子代繁殖群",
      "keeper": "林青",
      "condition": "断奶体重达标",
      "weaningWeights": [9.2, 9.8, 8.7, 10.1]
    },
    {
      "sex": "female",
      "count": 3,
      "cageId": "B-04",
      "project": "子代繁殖群",
      "keeper": "林青",
      "condition": "状态良好"
    }
  ]
}
```

**关键逻辑：**
- 按 `offspring` 数组批量创建动物，每只均为独立ID
- 每只子代自动填充 `fatherId`、`motherId`、`litterId`、`breedingInfo`
- 子代初始状态为 `quarantine`（检疫中），符合流程
- 自动生成断奶后7/14/21天观察节点
- 每只子代的 `notes` 中记录一条断奶分笼日志
- 检查每个目标笼位容量是否足够（现有+新增<=capacity）
- 窝仔状态标记为 `weaned`，配对状态标记为 `weaned`
- `sum(offspring[].count) <= totalPups`

**响应 201：**
```json
{
  "litter": { ... 更新后的窝仔 },
  "offspring": [ ... 新生成的子代动物数组 ],
  "totalCreated": 7
}
```

---

### 11. 繁育统计

**GET** `/breeding/stats`

**响应 200：**
```json
{
  "pairings": {
    "total": 2,
    "active": 1,
    "pending": 0,
    "pregnant": 1,
    "delivered": 1,
    "weaned": 0,
    "cancelled": 0
  },
  "litters": {
    "total": 1,
    "pending": 1,
    "weaned": 0,
    "totalPupsBorn": 8,
    "totalWeaned": 0,
    "weaningRate": 0,
    "avgLitterSize": 8
  },
  "offspringByStrain": {
    "C57BL/6J": 0
  }
}
```

---

### 12. 查询系谱（父母/同胞/子代）

**GET** `/breeding/genealogy/:animalId`

**响应 200：**
```json
{
  "animal": { "id": "...", "strain": "...", "sex": "...", ... },
  "father": { "id": "...", "strain": "...", ... },
  "mother": { "id": "...", "strain": "...", ... },
  "siblings": [ { "id": "...", "sex": "...", "cageId": "...", ... } ],
  "offspring": [ { "id": "...", "sex": "...", "birthDate": "...", ... } ]
}
```

无父母/同胞/子代时对应字段为空对象或空数组。

---

### 13. 查询指定亲本的所有子代

**GET** `/breeding/offspring/:parentId`

**响应 200：** 子代动物数组（非 removed 状态）

---

## 使用示例

### 示例1：完整繁育流程（配对→产仔→断奶）

```bash
# 1. 创建配对
curl -X POST http://localhost:3007/breeding/pairs \
  -H "Content-Type: application/json" \
  -d '{
    "cageId": "A-02",
    "maleId": "ani-2001",
    "femaleId": "ani-2002",
    "pairDate": "2026-06-14",
    "keeper": "林青",
    "notes": "C57BL/6J 繁育"
  }'

# 2. 推进状态：确认怀孕
curl -X POST http://localhost:3007/breeding/pairs/pair-xxx/status \
  -H "Content-Type: application/json" \
  -d '{ "status": "pregnant", "notes": "见栓确认" }'

# 3. 登记窝仔
curl -X POST http://localhost:3007/breeding/litters \
  -H "Content-Type: application/json" \
  -d '{
    "pairId": "pair-xxx",
    "birthDate": "2026-07-05",
    "totalPups": 8,
    "malePups": 4,
    "femalePups": 4,
    "keeper": "林青"
  }'

# 4. 断奶分笼，批量生成子代
curl -X POST http://localhost:3007/breeding/litters/litter-xxx/wean \
  -H "Content-Type: application/json" \
  -d '{
    "weanDate": "2026-07-26",
    "offspring": [
      { "sex": "male", "count": 4, "cageId": "A-02", "project": "子代繁育", "keeper": "林青" },
      { "sex": "female", "count": 4, "cageId": "B-04", "project": "子代繁育", "keeper": "林青" }
    ]
  }'
```

### 示例2：查看统计和系谱

```bash
# 繁育统计
curl http://localhost:3007/breeding/stats

# 某只动物的系谱
curl http://localhost:3007/breeding/genealogy/ani-2001

# 某只亲本的所有子代
curl http://localhost:3007/breeding/offspring/ani-2001
```

### 示例3：验证不影响原有功能

```bash
# 原有库存统计不变（子代断奶后为 quarantine，不计入 active released 统计）
curl http://localhost:3007/reports/stock

# 原有动物列表查询仍然可用
curl http://localhost:3007/animals?status=released

# 原有笼位移动不受影响
curl -X POST http://localhost:3007/animals/ani-1001/move \
  -H "Content-Type: application/json" \
  -d '{ "cageId": "A-02", "reason": "测试原有移动" }'
```

---

## 状态枚举

**配对状态：**
| 值 | 说明 |
|----|------|
| pending | 合笼待配种 |
| mated | 已确认交配 |
| pregnant | 确认怀孕 |
| delivered | 已产仔 |
| weaned | 已断奶（流程完成） |
| cancelled | 已取消 |

**窝仔状态：**
| 值 | 说明 |
|----|------|
| born | 已出生 |
| weaning | 待断奶 |
| weaned | 已断奶 |

---

## 校验规则汇总

**配对创建校验：**
- 父本/母本必须存在、已放行(released)、性别正确、品系一致
- 父本和母本不能相同
- 配对笼必须存在且为 active
- 父母本不能同时参与其他活跃配对（非 cancelled/weaned）

**窝仔创建校验：**
- 关联配对必须存在且非 cancelled
- 出生日期不能早于合笼日期
- malePups + femalePups <= totalPups

**断奶校验：**
- 窝仔必须存在且未 weaned
- 断奶日期不能早于出生日期
- offspring 必须是非空数组
- sum(count) <= totalPups
- 每个分组的 sex/cageId/count/keeper/project 必须有效
- 每个目标笼位容量必须充足
