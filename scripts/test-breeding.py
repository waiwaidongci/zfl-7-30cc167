#!/usr/bin/env python3
import subprocess, json, sys

passed = 0
failed = 0

def curl_get(path):
    r = subprocess.run(["curl", "-s", f"http://localhost:3007{path}"], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except:
        return {"raw": r.stdout, "err": r.stderr}

def curl_post(path, data):
    r = subprocess.run(
        ["curl", "-s", "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(data), f"http://localhost:3007{path}"],
        capture_output=True, text=True
    )
    try:
        return json.loads(r.stdout)
    except:
        return {"raw": r.stdout, "err": r.stderr}

def check(test_name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✓ {test_name}")
    else:
        failed += 1
        print(f"  ✗ {test_name} {detail}")

sep = "=" * 72

# ═══════════════════════════════════════════════════════════════
# 阶段一：验证 seed 示例数据落库
# ═══════════════════════════════════════════════════════════════

print(sep)
print("阶段一：验证 seed 示例数据落库")
print(sep)

print("\n▶ 测试1: 笼位数据落库（9个笼位，含繁育区D-01~D-04）")
cages = curl_get("/cages")
check("笼位总数=9", len(cages) == 9, f"实际{len(cages)}")
cage_ids = [c["id"] for c in cages]
check("含繁育区D-01", "D-01" in cage_ids)
check("含繁育区D-02", "D-02" in cage_ids)
check("含繁育区D-03", "D-03" in cage_ids)
check("含繁育区D-04", "D-04" in cage_ids)
d01 = next((c for c in cages if c["id"] == "D-01"), None)
check("D-01区域=繁育区", d01 and d01["area"] == "繁育区")
check("D-01容量=5", d01 and d01["capacity"] == 5)
d02 = next((c for c in cages if c["id"] == "D-02"), None)
check("D-02区域=繁育区", d02 and d02["area"] == "繁育区")

print("\n▶ 测试2: 动物数据落库（17只：10原始+7子代）")
animals = curl_get("/animals")
check("动物总数=17", len(animals) == 17, f"实际{len(animals)}")

statuses = {}
for a in animals:
    statuses[a["status"]] = statuses.get(a["status"], 0) + 1
print(f"  状态分布: {statuses}")
check("released=8", statuses.get("released") == 8, f"实际{statuses.get('released')}")
check("quarantine=8", statuses.get("quarantine") == 8, f"实际{statuses.get('quarantine')}")
check("quarantine_abnormal=1", statuses.get("quarantine_abnormal") == 1, f"实际{statuses.get('quarantine_abnormal')}")

check("所有动物含fatherId字段", all("fatherId" in a for a in animals))
check("所有动物含motherId字段", all("motherId" in a for a in animals))
check("所有动物含litterId字段", all("litterId" in a for a in animals))
check("所有动物含breedingInfo字段", all("breedingInfo" in a for a in animals))

print("\n▶ 测试3: 子代动物（7只ani-3001~3007）保留父母关系")
offspring = [a for a in animals if a.get("litterId")]
check("子代动物数=7", len(offspring) == 7, f"实际{len(offspring)}")
check("所有子代fatherId=ani-2001", all(a["fatherId"] == "ani-2001" for a in offspring))
check("所有子代motherId=ani-2002", all(a["motherId"] == "ani-2002" for a in offspring))
check("所有子代litterId=litter-demo-1", all(a["litterId"] == "litter-demo-1" for a in offspring))
check("所有子代status=quarantine", all(a["status"] == "quarantine" for a in offspring))

male_offspring = [a for a in offspring if a["sex"] == "male"]
female_offspring = [a for a in offspring if a["sex"] == "female"]
check("雄性子代=4只", len(male_offspring) == 4, f"实际{len(male_offspring)}")
check("雌性子代=3只", len(female_offspring) == 3, f"实际{len(female_offspring)}")
check("雄性子代在D-01", all(a["cageId"] == "D-01" for a in male_offspring))
check("雌性子代在D-02", all(a["cageId"] == "D-02" for a in female_offspring))

print("\n▶ 测试4: 子代breedingInfo完整性")
for a in offspring[:2]:
    bi = a.get("breedingInfo", {})
    check(f"{a['id']} breedingInfo.fatherId=ani-2001", bi.get("fatherId") == "ani-2001")
    check(f"{a['id']} breedingInfo.motherId=ani-2002", bi.get("motherId") == "ani-2002")
    check(f"{a['id']} breedingInfo.litterId=litter-demo-1", bi.get("litterId") == "litter-demo-1")
    check(f"{a['id']} breedingInfo.pairingId=pair-demo-1", bi.get("pairingId") == "pair-demo-1")
    check(f"{a['id']} breedingInfo.weanDate=2026-06-10", bi.get("weanDate") == "2026-06-10")
    check(f"{a['id']} breedingInfo.weaningWeight有值", bi.get("weaningWeight") is not None)

print("\n▶ 测试5: 子代断奶日志和观察节点")
sample = offspring[0]
weaning_notes = [n for n in sample.get("notes", []) if n.get("type") == "weaning"]
check("子代含断奶日志(type=weaning)", len(weaning_notes) > 0)
check("子代有observationNodes", len(sample.get("observationNodes", [])) > 0)
check("子代有weanedAt字段", sample.get("weanedAt") is not None)
check("子代有weaningWeight字段", sample.get("weaningWeight") is not None)

print("\n▶ 测试6: 繁育配对数据（3个配对：weaned/delivered/cancelled）")
pairs = curl_get("/breeding/pairs")
check("配对总数=3", len(pairs) == 3, f"实际{len(pairs)}")

pair1 = next((p for p in pairs if p["id"] == "pair-demo-1"), None)
pair2 = next((p for p in pairs if p["id"] == "pair-demo-2"), None)
pair3 = next((p for p in pairs if p["id"] == "pair-demo-3"), None)

check("pair-demo-1存在", pair1 is not None)
check("pair-demo-1状态=weaned", pair1 and pair1["status"] == "weaned")
check("pair-demo-1品系=C57BL/6J", pair1 and pair1["strain"] == "C57BL/6J")
check("pair-demo-1有deliveredAt", pair1 and pair1.get("deliveredAt") is not None)
check("pair-demo-1有weanedAt", pair1 and pair1.get("weanedAt") is not None)

check("pair-demo-2存在", pair2 is not None)
check("pair-demo-2状态=delivered", pair2 and pair2["status"] == "delivered")
check("pair-demo-2品系=BALB/c", pair2 and pair2["strain"] == "BALB/c")

check("pair-demo-3存在", pair3 is not None)
check("pair-demo-3状态=cancelled", pair3 and pair3["status"] == "cancelled")
check("pair-demo-3有cancelReason", pair3 and pair3.get("cancelReason") is not None)

print("\n▶ 测试7: 窝仔数据（2窝：weaned + born）")
litters = curl_get("/breeding/litters")
check("窝仔总数=2", len(litters) == 2, f"实际{len(litters)}")

litter1 = next((l for l in litters if l["id"] == "litter-demo-1"), None)
litter2 = next((l for l in litters if l["id"] == "litter-demo-2"), None)

check("litter-demo-1存在", litter1 is not None)
check("litter-demo-1状态=weaned", litter1 and litter1["status"] == "weaned")
check("litter-demo-1总产仔=8", litter1 and litter1["totalPups"] == 8)
check("litter-demo-1已断奶数=7", litter1 and litter1["weanedCount"] == 7)
check("litter-demo-1有weanDate=2026-06-10", litter1 and litter1.get("weanDate") == "2026-06-10")
check("litter-demo-1有weaningPlan", litter1 and litter1.get("weaningPlan") is not None and len(litter1.get("weaningPlan", [])) > 0)

check("litter-demo-2存在", litter2 is not None)
check("litter-demo-2状态=born", litter2 and litter2["status"] == "born")
check("litter-demo-2总产仔=6", litter2 and litter2["totalPups"] == 6)
check("litter-demo-2父本=ani-2003", litter2 and litter2.get("fatherId") == "ani-2003")
check("litter-demo-2母本=ani-2004", litter2 and litter2.get("motherId") == "ani-2004")

print("\n▶ 测试8: 繁育统计")
stats = curl_get("/breeding/stats")
check("配对总数=3", stats["pairings"]["total"] == 3)
check("已断奶=1", stats["pairings"]["weaned"] == 1)
check("已产仔=1", stats["pairings"]["delivered"] == 1)
check("已取消=1", stats["pairings"]["cancelled"] == 1)
check("窝仔总数=2", stats["litters"]["total"] == 2)
check("总产仔=14", stats["litters"]["totalPupsBorn"] == 14, f"实际{stats['litters']['totalPupsBorn']}")
check("已断奶子代=7", stats["litters"]["totalWeaned"] == 7, f"实际{stats['litters']['totalWeaned']}")
check("断奶率>0", stats["litters"]["weaningRate"] > 0)
check("子代品系分布含C57BL/6J", "C57BL/6J" in stats.get("offspringByStrain", {}))

print("\n▶ 测试9: 系谱查询（种母ani-2002，已有7个子代）")
gene = curl_get("/breeding/genealogy/ani-2002")
check("动物ID正确", gene["animal"]["id"] == "ani-2002")
check("子代数=7", len(gene["offspring"]) == 7, f"实际{len(gene['offspring'])}")
check("同胞=0（父母未知，无同胞）", len(gene["siblings"]) == 0)

print("\n▶ 测试10: 查亲本子代列表（ani-2001）")
offspring_list = curl_get("/breeding/offspring/ani-2001")
check("ani-2001子代数=7", len(offspring_list) == 7, f"实际{len(offspring_list)}")
check("子代全部非removed", all(o["status"] != "removed" for o in offspring_list))

print("\n▶ 测试11: 库存统计不被破坏")
stock = curl_get("/reports/stock")
check("released库存=8", stock["total"] == 8, f"实际{stock['total']}")
check("quarantine=8", stock["quarantine"] == 8, f"实际{stock['quarantine']}")
check("quarantine_abnormal=1", stock["quarantineAbnormal"] == 1, f"实际{stock['quarantineAbnormal']}")

# ═══════════════════════════════════════════════════════════════
# 阶段二：断奶示例流程端到端验证
# ═══════════════════════════════════════════════════════════════

print()
print(sep)
print("阶段二：断奶示例流程端到端验证（pair-demo-2 / litter-demo-2）")
print(sep)

print("\n▶ 步骤1: 确认litter-demo-2当前状态=born，待断奶")
litter2_before = curl_get("/breeding/litters/litter-demo-2")
check("litter-demo-2状态=born", litter2_before["status"] == "born")
check("litter-demo-2总产仔=6", litter2_before["totalPups"] == 6)
print(f"  当前窝仔: 总数{litter2_before['totalPups']} (♂{litter2_before['malePups']}/♀{litter2_before['femalePups']}/?{litter2_before['unknownSexPups']})")
print(f"  父本={litter2_before['fatherId']} 母本={litter2_before['motherId']}")

print("\n▶ 步骤2: 确认pair-demo-2当前状态=delivered")
pair2_before = curl_get("/breeding/pairs/pair-demo-2")
check("pair-demo-2状态=delivered", pair2_before["status"] == "delivered")

print("\n▶ 步骤3: 记录断奶前动物总数")
animals_before = curl_get("/animals")
total_before = len(animals_before)
print(f"  断奶前动物总数: {total_before}")

print("\n▶ 步骤4: 执行断奶分笼 POST /breeding/litters/litter-demo-2/wean")
wean_data = {
    "weanDate": "2026-07-01",
    "offspring": [
        {
            "sex": "male",
            "count": 3,
            "cageId": "D-03",
            "project": "BALB/c子代群",
            "keeper": "周遥",
            "condition": "断奶体重达标",
            "weaningWeights": [9.5, 10.2, 8.8]
        },
        {
            "sex": "female",
            "count": 2,
            "cageId": "D-04",
            "project": "BALB/c子代群",
            "keeper": "周遥",
            "condition": "状态良好"
        }
    ]
}
wean_result = curl_post("/breeding/litters/litter-demo-2/wean", wean_data)

if "error" in wean_result and "totalCreated" not in wean_result:
    print(f"  ❌ 断奶失败: {json.dumps(wean_result, ensure_ascii=False)}")
    check("断奶操作成功", False, json.dumps(wean_result, ensure_ascii=False))
else:
    check("断奶操作成功", True)
    check("生成子代数=5", wean_result["totalCreated"] == 5, f"实际{wean_result['totalCreated']}")
    check("窝仔状态=weaned", wean_result["litter"]["status"] == "weaned")
    check("窝仔weanedCount=5", wean_result["litter"]["weanedCount"] == 5)
    check("窝仔weanDate=2026-07-01", wean_result["litter"]["weanDate"] == "2026-07-01")

    print(f"\n  生成的5只子代:")
    for a in wean_result["offspring"]:
        print(f"    {a['id']}: {a['sex']} {a['strain']} 笼{a['cageId']} 状态={a['status']}")
        print(f"      fatherId={a['fatherId']} motherId={a['motherId']} litterId={a['litterId']}")

    new_offspring = wean_result["offspring"]
    check("所有子代fatherId=ani-2003", all(a["fatherId"] == "ani-2003" for a in new_offspring))
    check("所有子代motherId=ani-2004", all(a["motherId"] == "ani-2004" for a in new_offspring))
    check("所有子代litterId=litter-demo-2", all(a["litterId"] == "litter-demo-2" for a in new_offspring))
    check("所有子代status=quarantine", all(a["status"] == "quarantine" for a in new_offspring))
    check("所有子代strain=BALB/c", all(a["strain"] == "BALB/c" for a in new_offspring))
    check("所有子代有breedingInfo", all(a.get("breedingInfo") is not None for a in new_offspring))
    check("所有子代有observationNodes", all(len(a.get("observationNodes", [])) > 0 for a in new_offspring))

    male_new = [a for a in new_offspring if a["sex"] == "male"]
    female_new = [a for a in new_offspring if a["sex"] == "female"]
    check("雄性子代=3只", len(male_new) == 3)
    check("雌性子代=2只", len(female_new) == 2)
    check("雄性子代在D-03", all(a["cageId"] == "D-03" for a in male_new))
    check("雌性子代在D-04", all(a["cageId"] == "D-04" for a in female_new))

    print("\n▶ 步骤5: 验证breedingInfo完整性（取第1只子代）")
    sample_offspring = new_offspring[0]
    bi = sample_offspring.get("breedingInfo", {})
    check("breedingInfo.fatherId=ani-2003", bi.get("fatherId") == "ani-2003")
    check("breedingInfo.motherId=ani-2004", bi.get("motherId") == "ani-2004")
    check("breedingInfo.litterId=litter-demo-2", bi.get("litterId") == "litter-demo-2")
    check("breedingInfo.pairingId=pair-demo-2", bi.get("pairingId") == "pair-demo-2")
    check("breedingInfo.weanDate=2026-07-01", bi.get("weanDate") == "2026-07-01")

    print("\n▶ 步骤6: 验证配对状态自动推进为weaned")
    pair2_after = curl_get("/breeding/pairs/pair-demo-2")
    check("pair-demo-2状态=weaned", pair2_after["status"] == "weaned")

    print("\n▶ 步骤7: 验证动物总数增长")
    animals_after = curl_get("/animals")
    total_after = len(animals_after)
    check(f"动物总数从{total_before}增加到{total_after}", total_after == total_before + 5, f"实际{total_after}")

    print("\n▶ 步骤8: 验证库存统计不受影响")
    stock_after = curl_get("/reports/stock")
    check("released库存仍=8", stock_after["total"] == 8, f"实际{stock_after['total']}")
    check(f"quarantine=8+5=13", stock_after["quarantine"] == 13, f"实际{stock_after['quarantine']}")

    print("\n▶ 步骤9: 断奶后系谱查询（ani-2004应有5个子代）")
    gene_after = curl_get("/breeding/genealogy/ani-2004")
    check("ani-2004子代数=5", len(gene_after["offspring"]) == 5, f"实际{len(gene_after['offspring'])}")

    print("\n▶ 步骤10: 断奶后查亲本子代列表（ani-2003）")
    off_2003 = curl_get("/breeding/offspring/ani-2003")
    check("ani-2003子代数=5", len(off_2003) == 5, f"实际{len(off_2003)}")

# ═══════════════════════════════════════════════════════════════
# 阶段三：校验功能测试
# ═══════════════════════════════════════════════════════════════

print()
print(sep)
print("阶段三：校验功能测试")
print(sep)

print("\n▶ 测试: quarantine动物不能参与配对")
bad_pair = curl_post("/breeding/pairs", {
    "cageId": "C-01", "maleId": "ani-1003", "femaleId": "ani-1004",
    "pairDate": "2026-06-14", "keeper": "林青"
})
check("quarantine动物配对被拒绝", bad_pair.get("error") == "validation_failed")
if bad_pair.get("details"):
    codes = [d["code"] for d in bad_pair["details"]]
    print(f"  错误码: {codes}")

print("\n▶ 测试: 已weaned窝仔不能重复断奶")
re_wean = curl_post("/breeding/litters/litter-demo-1/wean", {
    "weanDate": "2026-07-15",
    "offspring": [{"sex": "male", "count": 1, "cageId": "D-03", "project": "test", "keeper": "周遥"}]
})
check("已断奶窝仔拒绝重复断奶", re_wean.get("error") is not None)

print("\n▶ 测试: 活跃配对中的动物不能重复配对（ani-2003在pair-demo-2中）")
dup_pair = curl_post("/breeding/pairs", {
    "cageId": "B-03", "maleId": "ani-2003", "femaleId": "ani-2006",
    "pairDate": "2026-06-14", "keeper": "林青"
})
check("活跃配对动物被拒绝", dup_pair.get("error") == "validation_failed")

print("\n▶ 测试: 品系不一致的动物不能配对")
strain_mismatch = curl_post("/breeding/pairs", {
    "cageId": "B-03", "maleId": "ani-1002", "femaleId": "ani-2006",
    "pairDate": "2026-06-14", "keeper": "林青"
})
check("品系不一致被拒绝", strain_mismatch.get("error") == "validation_failed")
if strain_mismatch.get("details"):
    codes = [d["code"] for d in strain_mismatch["details"]]
    check("错误码含strain_mismatch", "strain_mismatch" in codes, f"实际{codes}")

print("\n▶ 测试: 取消配对")
cancel_r = curl_post("/breeding/pairs/pair-demo-3/cancel", {"reason": "再次确认取消"})
pair3_after = curl_get("/breeding/pairs/pair-demo-3")
check("pair-demo-3仍为cancelled", pair3_after["status"] == "cancelled")

# ═══════════════════════════════════════════════════════════════
# 阶段四：不破坏原有功能
# ═══════════════════════════════════════════════════════════════

print()
print(sep)
print("阶段四：不破坏原有功能验证")
print(sep)

print("\n▶ 测试: 动物笼位移动")
move_r = curl_post("/animals/ani-1001/move", {"cageId": "A-01", "reason": "繁育模块集成后移动测试"})
check("移动成功", move_r.get("cageId") == "A-01")
check("移动记录存在", len(move_r.get("moves", [])) >= 2)

print("\n▶ 测试: 动物备注")
note_r = curl_post("/animals/ani-1001/notes", {"weight": 21.5, "condition": "正常", "keeper": "林青"})
check("备注添加成功(返回note对象)", note_r.get("id") is not None and note_r.get("condition") == "正常")

print("\n▶ 测试: 饲喂计划")
feed_plans = curl_get("/feeding/plans")
check("饲喂计划正常返回", len(feed_plans) >= 4)

print("\n▶ 测试: 即将到期观察节点")
upcoming = curl_get("/reports/upcoming?days=30")
check("观察节点查询正常", isinstance(upcoming, list))

# ═══════════════════════════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════════════════════════

print()
print(sep)
if failed == 0:
    print(f"✅ 全部 {passed} 项测试通过！")
else:
    print(f"⚠️ 通过 {passed} 项，失败 {failed} 项")
print(sep)

sys.exit(1 if failed > 0 else 0)
