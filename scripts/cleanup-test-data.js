import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TEST_CAGE_IDS = [
  "T-TEST-1781500097083",
  "T-TEST-1781500810968",
  "T-TEST-1781501321298",
  "CAGE-TEST6-1781501321236",
  "CAGE-TEST8-1781501321258",
  "CAGE-TEST9-1781501321276",
  "CAGE-TEST10-1781501321289"
];

const TEST_KEEPER_ID = "keeper-1781498215128-jst";

async function cleanup() {
  const labPath = join(process.cwd(), "data", "lab.json");
  const raw = await readFile(labPath, "utf-8");
  const db = JSON.parse(raw);

  console.log("=== 清理前统计 ===");
  console.log("笼子总数:", db.cages.length);
  console.log("饲养员总数:", db.keepers?.length || 0);
  console.log("动物总数:", db.animals.length);

  let removedCages = 0;
  let removedKeepers = 0;

  // 清理TEST笼子
  const originalCageCount = db.cages.length;
  db.cages = db.cages.filter(c => !TEST_CAGE_IDS.includes(c.id));
  removedCages = originalCageCount - db.cages.length;

  // 清理测试员
  if (db.keepers) {
    const originalKeeperCount = db.keepers.length;
    db.keepers = db.keepers.filter(k => k.id !== TEST_KEEPER_ID);
    removedKeepers = originalKeeperCount - db.keepers.length;
  }

  console.log("\n=== 清理操作 ===");
  console.log("删除TEST笼子:", removedCages, "个");
  console.log("删除测试员:", removedKeepers, "个");

  console.log("\n=== 清理后统计 ===");
  console.log("笼子总数:", db.cages.length);
  console.log("饲养员总数:", db.keepers?.length || 0);
  console.log("动物总数:", db.animals.length);

  // 验证数据一致性
  console.log("\n=== 数据一致性检查 ===");
  
  const cageIds = new Set(db.cages.map(c => c.id));
  const animalCageIssues = db.animals.filter(a => a.cageId && !cageIds.has(a.cageId));
  console.log("动物引用不存在的笼子:", animalCageIssues.length, "个");

  const keeperIds = new Set((db.keepers || []).map(k => k.id));
  const animalKeeperIssues = db.animals.filter(a => 
    (a.keeperId && !keeperIds.has(a.keeperId)) ||
    (a.keeper?.id && !keeperIds.has(a.keeper.id))
  );
  console.log("动物引用不存在的饲养员:", animalKeeperIssues.length, "个");

  // 保存
  await writeFile(labPath, JSON.stringify(db, null, 2) + "\n", "utf-8");
  console.log("\n已保存到 lab.json");
}

cleanup().catch(console.error);
