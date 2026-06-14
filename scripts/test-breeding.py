#!/usr/bin/env python3
import subprocess, json, sys

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

sep = "=" * 70

print(sep)
print("测试1: 现有动物列表（验证不破坏）")
print(sep)
animals = curl_get("/animals")
print(f"动物总数: {len(animals)}")
statuses = {}
for a in animals:
    statuses[a['status']] = statuses.get(a['status'], 0) + 1
print(f"状态分布: {statuses}")
print(f"含繁育字段(fatherId)的动物: {sum(1 for a in animals if 'fatherId' in a)}")
print(f"前2只 fatherId/motherId/litterId: {(animals[0].get('fatherId'), animals[0].get('motherId'), animals[0].get('litterId'))}")
assert len(animals) == 8, f"预期8只动物，实际{len(animals)}"
assert statuses.get('released') == 6, f"预期6只released"
assert 'fatherId' in animals[0], "fatherId字段缺失（migrateDb未生效）"
print("✓ 原有动物列表正常")

print()
print(sep)
print("测试2: 库存统计（验证不破坏）")
print(sep)
stock = curl_get("/reports/stock")
print(f"库存总数(released): {stock['total']}")
print(f"按项目: {stock['byProject']}")
print(f"按笼位: {stock['byCage']}")
print(f"检疫中: {stock['quarantine']}, 检疫异常: {stock['quarantineAbnormal']}")
assert stock['total'] == 6
print("✓ 原有库存统计正常")

print()
print(sep)
print("测试3: 笼位列表（验证不破坏）")
print(sep)
cages = curl_get("/cages")
print(f"笼位总数: {len(cages)}")
for c in cages:
    print(f"  {c['id']}: area={c['area']} status={c['status']} occupancy={c['occupancy']}/{c['capacity']}")
print("✓ 原有笼位正常")

print()
print(sep)
print("测试4: 繁育配对列表（示例数据）")
print(sep)
pairs = curl_get("/breeding/pairs")
print(f"配对数: {len(pairs)}")
for p in pairs:
    print(f"  {p['id']}: {p['strain']} ♂{p['maleId']}×♀{p['femaleId']} 笼{p['cageId']} 状态={p['status']}")
    print(f"       观察节点: {p['observationNodes']}")
    print(f"       关联窝仔: {p['litterCount']}个, 产仔总数: {p['totalPups']}")
assert len(pairs) == 2
print("✓ 配对列表正常")

print()
print(sep)
print("测试5: 繁育窝仔列表（示例数据）")
print(sep)
litters = curl_get("/breeding/litters")
print(f"窝仔数: {len(litters)}")
for l in litters:
    print(f"  {l['id']}: 配对{l['pairId']} 出生{l['birthDate']}")
    print(f"       总数{l['totalPups']}(♂{l['malePups']}/♀{l['femalePups']}/?{l['unknownSexPups']})")
    print(f"       父={l['fatherId']} 母={l['motherId']} 已断奶={l['weanedCount']} 状态={l['status']}")
assert len(litters) == 1
print("✓ 窝仔列表正常")

print()
print(sep)
print("测试6: 繁育统计")
print(sep)
stats = curl_get("/breeding/stats")
print(json.dumps(stats, ensure_ascii=False, indent=2))
assert stats['pairings']['total'] == 2
assert stats['litters']['total'] == 1
assert stats['litters']['totalPupsBorn'] == 8
print("✓ 繁育统计正常")

print()
print(sep)
print("测试7: 系谱查询（种母 ani-2002）")
print(sep)
genealogy = curl_get("/breeding/genealogy/ani-2002")
print(f"动物: {genealogy['animal']['id']} {genealogy['animal']['strain']} {genealogy['animal']['sex']}")
print(f"父本: {genealogy['father']}")
print(f"母本: {genealogy['mother']}")
print(f"同胞: {len(genealogy['siblings'])}只")
print(f"子代: {genealogy['offspring']} (断奶前应为空)")
assert genealogy['animal']['id'] == 'ani-2002'
print("✓ 系谱查询正常")

print()
print(sep)
print("测试8: 关键! 断奶分笼 批量生成子代（litter-demo-1）")
print(sep)
wean_data = {
    "weanDate": "2026-07-01",
    "offspring": [
        {
            "sex": "male",
            "count": 3,
            "cageId": "A-02",
            "project": "子代繁育群",
            "keeper": "林青",
            "condition": "断奶体重达标",
            "weaningWeights": [9.2, 9.8, 8.7]
        },
        {
            "sex": "female",
            "count": 3,
            "cageId": "B-04",
            "project": "子代繁育群",
            "keeper": "林青",
            "condition": "状态良好"
        }
    ]
}
wean_result = curl_post("/breeding/litters/litter-demo-1/wean", wean_data)
if 'error' in wean_result:
    print(f"❌ 断奶失败: {wean_result}")
    sys.exit(1)
print(f"生成子代数: {wean_result['totalCreated']}")
print(f"窝仔状态: {wean_result['litter']['status']} 断奶日期: {wean_result['litter']['weanDate']}")
print(f"子代列表 (6只):")
for a in wean_result['offspring']:
    print(f"  {a['id']}: {a['sex']} {a['strain']} 笼{a['cageId']} 状态={a['status']}")
    print(f"       fatherId={a['fatherId']} motherId={a['motherId']} litterId={a['litterId']}")
    print(f"       breedingInfo={json.dumps(a['breedingInfo'], ensure_ascii=False)}")
    print(f"       observationNodes={a['observationNodes']}")
assert wean_result['totalCreated'] == 6
assert wean_result['litter']['status'] == 'weaned'
assert all(a['fatherId'] == 'ani-2001' for a in wean_result['offspring']), "父本ID错误"
assert all(a['motherId'] == 'ani-2002' for a in wean_result['offspring']), "母本ID错误"
assert all(a['litterId'] == 'litter-demo-1' for a in wean_result['offspring']), "窝仔ID错误"
assert all(a['status'] == 'quarantine' for a in wean_result['offspring']), "子代状态应为quarantine"
print("✓ 断奶批量生成子代成功，父母关系完整保留！")

print()
print(sep)
print("测试9: 验证断奶后库存统计不被破坏（子代quarantine不计入released库存）")
print(sep)
stock2 = curl_get("/reports/stock")
print(f"库存总数(released)仍为: {stock2['total']} (应为6，quarantine不计入)")
print(f"检疫中数: {stock2['quarantine']} (应为1+6=7)")
print(f"按笼位: {stock2['byCage']}")
assert stock2['total'] == 6, f"库存总数被破坏！预期6，实际{stock2['total']}"
assert stock2['quarantine'] == 7, f"quarantine计数错误，应为7，实际{stock2['quarantine']}"
print("✓ 库存统计正常，未被破坏！")

print()
print(sep)
print("测试10: 动物移动验证（笼位容量检查）")
print(sep)
move_result = curl_post("/animals/ani-1001/move", {"cageId": "A-01", "reason": "测试移动功能正常"})
print(f"移动结果: cageId={move_result.get('cageId')}")
print(f"移动记录数: {len(move_result.get('moves', []))}")
assert move_result.get('cageId') == 'A-01'
print("✓ 笼位移动功能正常")

print()
print(sep)
print("测试11: 断奶后再查系谱（ani-2002应有6个子代）")
print(sep)
genealogy2 = curl_get("/breeding/genealogy/ani-2002")
print(f"子代数量: {len(genealogy2['offspring'])}")
for o in genealogy2['offspring']:
    print(f"  {o['id']}: {o['sex']} 出生{o['birthDate']} 状态={o['status']}")
assert len(genealogy2['offspring']) == 6
print("✓ 系谱查询正确反映子代")

print()
print(sep)
print("测试12: 配对状态自动变为weaned")
print(sep)
pair1 = curl_get("/breeding/pairs/pair-demo-1")
print(f"配对状态: {pair1['status']} (应为 weaned)")
assert pair1['status'] == 'weaned'
print("✓ 配对状态自动更新为weaned")

print()
print(sep)
print("测试13: 新建配对（校验功能）")
print(sep)
new_pair = {
    "cageId": "C-01",
    "maleId": "ani-1003",
    "femaleId": "ani-1004",
    "pairDate": "2026-06-14",
    "keeper": "林青"
}
create_r = curl_post("/breeding/pairs", new_pair)
print(f"创建结果错误(预期失败，ani-1003为quarantine不能繁育): {create_r.get('error')}")
print(f"错误详情: {json.dumps(create_r.get('details', []), ensure_ascii=False)}")
assert create_r.get('error') == 'validation_failed'
print("✓ 父本状态校验正常（quarantine不能参与配对）")

print()
print(sep)
print("✅ 全部测试通过！")
print(sep)
