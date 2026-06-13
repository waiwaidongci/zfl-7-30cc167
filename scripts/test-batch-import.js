import http from "node:http";
import { readFile } from "node:fs/promises";

const BASE_URL = "http://localhost:3007";

function request(path, method, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: { "Content-Type": "application/json" }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log("=" .repeat(60));
  console.log("动物批量导入模块测试");
  console.log("=" .repeat(60));

  const sampleData = JSON.parse(
    await readFile(new URL("../data/sample-import.json", import.meta.url), "utf8")
  );

  console.log("\n1. 测试导入预览接口 POST /animals/import/preview");
  console.log("-".repeat(60));

  const previewRes = await request("/animals/import/preview", "POST", sampleData);
  console.log(`状态码: ${previewRes.status}`);
  console.log(`总数: ${previewRes.body.total}`);
  console.log(`可导入: ${previewRes.body.importable}`);
  console.log(`字段错误数: ${previewRes.body.fieldErrors.length}`);
  console.log(`重复ID数: ${previewRes.body.duplicateIds.length}`);
  console.log(`缺失笼位数: ${previewRes.body.missingCages.length}`);
  console.log(`容量冲突数: ${previewRes.body.capacityConflicts.length}`);
  console.log(`有效记录数: ${previewRes.body.validItems.length}`);

  if (previewRes.body.fieldErrors.length > 0) {
    console.log("\n字段错误详情:");
    previewRes.body.fieldErrors.forEach((err) => {
      console.log(`  索引 ${err.index}: ${err.errors.map(e => e.message).join(", ")}`);
    });
  }

  if (previewRes.body.duplicateIds.length > 0) {
    console.log("\n重复ID详情:");
    previewRes.body.duplicateIds.forEach((dup) => {
      console.log(`  索引 ${dup.index}: ${dup.id} - ${dup.message}`);
    });
  }

  if (previewRes.body.missingCages.length > 0) {
    console.log("\n缺失笼位详情:");
    previewRes.body.missingCages.forEach((cage) => {
      console.log(`  ${cage.cageId}: ${cage.message}`);
    });
  }

  if (previewRes.body.capacityConflicts.length > 0) {
    console.log("\n容量冲突详情:");
    previewRes.body.capacityConflicts.forEach((conf) => {
      console.log(`  ${conf.cageId}: 当前${conf.currentOccupancy} + 导入${conf.batchCount} = ${conf.afterImport}/${conf.capacity} (超出${conf.overflow})`);
    });
  }

  console.log("\n2. 测试确认导入接口 POST /animals/import");
  console.log("-".repeat(60));

  const importRes = await request("/animals/import", "POST", sampleData);
  console.log(`状态码: ${importRes.status}`);
  console.log(`成功导入: ${importRes.body.imported}`);
  console.log(`请求总数: ${importRes.body.totalRequested}`);
  console.log(`跳过数: ${importRes.body.skipped}`);

  if (importRes.body.animals) {
    console.log("\n导入的动物:");
    importRes.body.animals.forEach((a) => {
      console.log(`  ${a.id}: ${a.strain} - ${a.cageId} - ${a.sex}`);
    });
  }

  console.log("\n3. 验证导入结果 GET /animals");
  console.log("-".repeat(60));

  const animalsRes = await request("/animals", "GET");
  console.log(`动物总数: ${animalsRes.body.length}`);
  const activeAnimals = animalsRes.body.filter(a => a.status === "active");
  console.log(`活跃动物数: ${activeAnimals.length}`);

  console.log("\n4. 测试空数组导入预览");
  console.log("-".repeat(60));

  const emptyPreviewRes = await request("/animals/import/preview", "POST", []);
  console.log(`状态码: ${emptyPreviewRes.status}`);
  console.log(`错误: ${emptyPreviewRes.body.error}`);

  console.log("\n5. 测试非数组输入");
  console.log("-".repeat(60));

  const invalidInputRes = await request("/animals/import/preview", "POST", { not: "array" });
  console.log(`状态码: ${invalidInputRes.status}`);
  console.log(`错误: ${invalidInputRes.body.error}`);

  console.log("\n6. 测试单个动物建档 POST /animals");
  console.log("-".repeat(60));

  const singleAnimal = {
    id: "ani-3001",
    strain: "C57BL/6J",
    cageId: "A-02",
    sex: "female",
    birthDate: "2026-04-01",
    project: "测试项目",
    keeper: "测试员"
  };
  const singleRes = await request("/animals", "POST", singleAnimal);
  console.log(`状态码: ${singleRes.status}`);
  if (singleRes.status === 201) {
    console.log(`创建成功: ${singleRes.body.id}`);
  } else {
    console.log(`错误: ${singleRes.body.error}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("测试完成");
  console.log("=".repeat(60));
}

runTests().catch((err) => {
  console.error("测试失败:", err.message);
  process.exit(1);
});
