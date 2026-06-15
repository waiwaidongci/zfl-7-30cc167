import http from "node:http";
import { readFile } from "node:fs/promises";

const BASE_URL = "http://localhost:3007";

const API_KEYS = {
  ADMIN: "admin-key-demo-001",
  KEEPER_LQ: "keeper-key-demo-001",
  KEEPER_ZY: "keeper-key-demo-002",
  PROJECT_KEEPER: "project-keeper-demo-001"
};

function request(path, method, body, apiKey = API_KEYS.ADMIN) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey
      }
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
  console.log(`缺失房间数: ${(previewRes.body.missingRooms || []).length}`);
  console.log(`缺失区域数: ${(previewRes.body.missingZones || []).length}`);
  console.log(`缺失项目数: ${(previewRes.body.missingProjects || []).length}`);
  console.log(`房间不匹配数: ${(previewRes.body.roomMismatches || []).length}`);
  console.log(`区域不匹配数: ${(previewRes.body.zoneMismatches || []).length}`);
  console.log(`项目不匹配数: ${(previewRes.body.projectMismatches || []).length}`);
  console.log(`项目权限错误数: ${(previewRes.body.projectPermissionErrors || []).length}`);
  console.log(`容量冲突数: ${previewRes.body.capacityConflicts.length}`);
  console.log(`房间权限错误数: ${(previewRes.body.roomPermissionErrors || []).length}`);
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
      console.log(`  索引 ${dup.index}: ${dup.id} - ${dup.type} - ${dup.message}`);
    });
  }

  if (previewRes.body.missingCages.length > 0) {
    console.log("\n缺失笼位详情:");
    previewRes.body.missingCages.forEach((cage) => {
      console.log(`  ${cage.cageId}: ${cage.message}`);
    });
  }

  if (previewRes.body.roomMismatches && previewRes.body.roomMismatches.length > 0) {
    console.log("\n房间不匹配详情:");
    previewRes.body.roomMismatches.forEach((m) => {
      console.log(`  索引 ${m.index} 笼位 ${m.cageId}: 输入房间 ${m.inputRoomName || m.inputRoomId} != 笼位房间 ${m.cageRoomName || m.cageRoomId}`);
      console.log(`    提示: ${m.message}`);
    });
  }

  if (previewRes.body.zoneMismatches && previewRes.body.zoneMismatches.length > 0) {
    console.log("\n区域不匹配详情:");
    previewRes.body.zoneMismatches.forEach((m) => {
      console.log(`  索引 ${m.index} 笼位 ${m.cageId}: 输入区域 ${m.inputZoneName || m.inputZoneId} != 笼位区域 ${m.cageZoneName || m.cageZoneId}`);
      console.log(`    提示: ${m.message}`);
    });
  }

  if (previewRes.body.projectMismatches && previewRes.body.projectMismatches.length > 0) {
    console.log("\n项目不匹配详情:");
    previewRes.body.projectMismatches.forEach((m) => {
      console.log(`  索引 ${m.index}: projectId=${m.inputProjectName || m.inputProjectId} vs project名称=${m.nameProjectName || m.nameProjectId}`);
      console.log(`    提示: ${m.message}`);
    });
  }

  if (previewRes.body.capacityConflicts.length > 0) {
    console.log("\n容量冲突详情:");
    previewRes.body.capacityConflicts.forEach((conf) => {
      console.log(`  ${conf.cageId} (${conf.roomName || conf.roomId}): 当前${conf.currentOccupancy} + 导入${conf.batchCount} = ${conf.afterImport}/${conf.capacity} (超出${conf.overflow})`);
    });
  }

  if (previewRes.body.validItems.length > 0) {
    console.log("\n有效记录详情（含房间/区域/项目信息）:");
    previewRes.body.validItems.slice(0, 3).forEach((item) => {
      console.log(`  索引${item.index}: ${item.id || '(无ID)'} - ${item.strain}`);
      console.log(`    笼位: ${item.cageId} | 房间: ${item.roomName || item.roomId} (${item.roomId})`);
      console.log(`    区域: ${item.zoneName || item.zoneId} (${item.zoneId})`);
      console.log(`    项目: ${item.projectName || item.project} (${item.projectId})`);
    });
    if (previewRes.body.validItems.length > 3) {
      console.log(`  ... 还有 ${previewRes.body.validItems.length - 3} 条有效记录`);
    }
  }

  console.log("\n2. 测试确认导入接口 POST /animals/import");
  console.log("-".repeat(60));

  const importRes = await request("/animals/import", "POST", sampleData);
  console.log(`状态码: ${importRes.status}`);
  if (importRes.status === 201) {
    console.log(`成功导入: ${importRes.body.imported}`);
    console.log(`请求总数: ${importRes.body.totalRequested}`);
    console.log(`跳过数: ${importRes.body.skipped}`);

    if (importRes.body.animals) {
      console.log("\n导入的动物（验证roomId/zoneId/projectId归属）:");
      importRes.body.animals.slice(0, 3).forEach((a) => {
        console.log(`  ${a.id}: cage=${a.cageId}, room=${a.roomId}, zone=${a.zoneId}, projectId=${a.projectId}, project=${a.project}`);
      });
    }

    if (importRes.body.warnings) {
      const w = importRes.body.warnings;
      console.log("\n警告统计:");
      console.log(`  字段错误: ${(w.fieldErrors || []).length}`);
      console.log(`  重复ID: ${(w.duplicateIds || []).length}`);
      console.log(`  房间不匹配: ${(w.roomMismatches || []).length}`);
      console.log(`  区域不匹配: ${(w.zoneMismatches || []).length}`);
      console.log(`  项目不匹配: ${(w.projectMismatches || []).length}`);
      console.log(`  容量冲突: ${(w.capacityConflicts || []).length}`);
    }
  } else {
    console.log(`错误: ${importRes.body.error}`);
    console.log(`详情: ${JSON.stringify(importRes.body.details || {}, null, 2).slice(0, 500)}`);
  }

  console.log("\n3. 验证导入结果 GET /animals");
  console.log("-".repeat(60));

  const animalsRes = await request("/animals", "GET");
  console.log(`动物总数: ${animalsRes.body.length}`);
  const activeAnimals = animalsRes.body.filter(a => a.status === "released" || a.status === "quarantine");
  console.log(`活跃动物数: ${activeAnimals.length}`);
  const withFacilityFields = animalsRes.body.filter(a => a.roomId && a.zoneId && a.projectId);
  console.log(`含设施字段(roomId/zoneId/projectId)的动物数: ${withFacilityFields.length}`);

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

  console.log("\n6. 测试单个动物建档 POST /animals（含roomId/zoneId/projectId）");
  console.log("-".repeat(60));

  const testCage6Id = "CAGE-TEST6-" + Date.now();
  await request("/cages", "POST", {
    id: testCage6Id,
    roomId: "room-default",
    zoneId: "zone-default",
    area: "SPF区",
    rack: "T",
    capacity: 10,
    status: "active"
  }, API_KEYS.ADMIN);

  const singleAnimal = {
    id: "ani-test-single-" + Date.now(),
    strain: "C57BL/6J",
    cageId: testCage6Id,
    roomId: "room-default",
    zoneId: "zone-default",
    projectId: "proj-metabolism",
    sex: "female",
    birthDate: "2026-04-01",
    project: "代谢观察",
    keeper: "测试员"
  };
  const singleRes = await request("/animals", "POST", singleAnimal);
  console.log(`状态码: ${singleRes.status}`);
  if (singleRes.status === 201) {
    const a = singleRes.body;
    console.log(`创建成功: ${a.id}`);
    console.log(`  roomId: ${a.roomId} (期望: room-default)`);
    console.log(`  zoneId: ${a.zoneId} (期望: zone-default 来自笼位)`);
    console.log(`  projectId: ${a.projectId} (期望: proj-metabolism)`);
  } else {
    console.log(`错误: ${singleRes.body.error}`);
    if (singleRes.body.details) {
      singleRes.body.details.forEach(e => console.log(`  - ${e.message}`));
    }
  }

  console.log("\n7. 测试roomId/zoneId/projectId字段格式校验");
  console.log("-".repeat(60));

  const invalidFieldsData = [{
    id: "ani-test-invalid-fields",
    strain: "C57BL/6J",
    cageId: "A-01",
    roomId: "",
    zoneId: 123,
    projectId: null,
    sex: "female",
    birthDate: "2026-04-01",
    project: "代谢观察",
    keeper: "测试员"
  }];
  const invalidFieldsRes = await request("/animals/import/preview", "POST", invalidFieldsData);
  console.log(`字段错误数: ${invalidFieldsRes.body.fieldErrors.length}`);
  if (invalidFieldsRes.body.fieldErrors.length > 0) {
    invalidFieldsRes.body.fieldErrors[0].errors.forEach(e => {
      if (e.code && (e.code.includes("room") || e.code.includes("zone") || e.code.includes("project"))) {
        console.log(`  ${e.field}: ${e.message}`);
      }
    });
  }

  console.log("\n8. 测试房间归属一致性（导入时roomId与笼位不一致，应以笼位为准）");
  console.log("-".repeat(60));

  const testCage8Id = "CAGE-TEST8-" + Date.now();
  await request("/cages", "POST", {
    id: testCage8Id,
    roomId: "room-default",
    zoneId: "zone-default",
    area: "SPF区",
    rack: "T",
    capacity: 10,
    status: "active"
  }, API_KEYS.ADMIN);

  const mismatchData = [{
    id: "ani-test-mismatch-" + Date.now(),
    strain: "C57BL/6J",
    cageId: testCage8Id,
    roomId: "room-secondary",
    zoneId: "zone-default",
    projectId: "proj-metabolism",
    sex: "male",
    birthDate: "2026-04-02",
    project: "代谢观察",
    keeper: "测试员"
  }];
  const mismatchRes = await request("/animals/import", "POST", mismatchData);
  if (mismatchRes.status === 201 && mismatchRes.body.animals && mismatchRes.body.animals.length > 0) {
    const a = mismatchRes.body.animals[0];
    console.log(`导入动物 roomId: ${a.roomId}`);
    console.log(`笼位 ${testCage8Id} 所属房间应为: room-default`);
    console.log(`结果: ${a.roomId === "room-default" ? "✓ 正确，以笼位所属房间为准" : "✗ 错误"}`);
    if (mismatchRes.body.warnings && mismatchRes.body.warnings.roomMismatches) {
      console.log(`警告中包含房间不匹配提示: ${mismatchRes.body.warnings.roomMismatches.length > 0 ? "✓ 是" : "✗ 否"}`);
    }
  }

  console.log("\n9. 测试projectId优先级（projectId优先于project名称解析）");
  console.log("-".repeat(60));

  const testCage9Id = "CAGE-TEST9-" + Date.now();
  await request("/cages", "POST", {
    id: testCage9Id,
    roomId: "room-default",
    zoneId: "zone-default",
    area: "SPF区",
    rack: "T",
    capacity: 10,
    status: "active"
  }, API_KEYS.ADMIN);

  const projectPriorityData = [{
    id: "ani-test-proj-priority-" + Date.now(),
    strain: "BALB/c",
    cageId: testCage9Id,
    roomId: "room-default",
    zoneId: "zone-default",
    projectId: "proj-oncology",
    sex: "female",
    birthDate: "2026-04-03",
    project: "代谢观察",
    keeper: "测试员"
  }];
  const projPriorityPreview = await request("/animals/import/preview", "POST", projectPriorityData);
  console.log(`预览阶段 - 项目不匹配数: ${(projPriorityPreview.body.projectMismatches || []).length}`);
  if (projPriorityPreview.body.projectMismatches && projPriorityPreview.body.projectMismatches.length > 0) {
    const m = projPriorityPreview.body.projectMismatches[0];
    console.log(`  projectId=${m.inputProjectName || m.inputProjectId} vs project名称=${m.nameProjectName || m.nameProjectId}`);
    console.log(`  提示: ${m.message}`);
  }

  const projPriorityRes = await request("/animals/import", "POST", projectPriorityData);
  if (projPriorityRes.status === 201 && projPriorityRes.body.animals && projPriorityRes.body.animals.length > 0) {
    const a = projPriorityRes.body.animals[0];
    console.log(`导入动物 projectId: ${a.projectId}`);
    console.log(`project名称: ${a.project} (输入为"代谢观察")`);
    console.log(`期望 projectId: proj-oncology (肿瘤研究)`);
    console.log(`结果: ${a.projectId === "proj-oncology" ? "✓ 正确，projectId优先" : "✗ 错误"}`);
    if (projPriorityRes.body.warnings && projPriorityRes.body.warnings.projectMismatches) {
      console.log(`警告中包含项目不匹配提示: ${projPriorityRes.body.warnings.projectMismatches.length > 0 ? "✓ 是" : "✗ 否"}`);
    }
  } else if (projPriorityRes.status !== 201) {
    console.log(`导入状态码: ${projPriorityRes.status}`);
    if (projPriorityRes.body.error) console.log(`错误: ${projPriorityRes.body.error}`);
    const mismatches = (projPriorityRes.body.details?.projectMismatches) || (projPriorityRes.body.warnings?.projectMismatches) || [];
    console.log(`项目不匹配提示数: ${mismatches.length}`);
    if (projPriorityPreview.body.validItems && projPriorityPreview.body.validItems.length > 0) {
      const v = projPriorityPreview.body.validItems[0];
      console.log(`预览解析 projectId: ${v.projectId} (${v.projectName})`);
      console.log(`结果: ${v.projectId === "proj-oncology" ? "✓ 预览阶段已正确解析projectId，projectId优先于project名称" : "✗ 解析错误"}`);
    }
  }

  console.log("\n10. 测试keeper账号项目权限限制（project-keeper-demo-001只能访问肿瘤研究和默认项目）");
  console.log("-".repeat(60));

  const testCage10Id = "CAGE-TEST10-" + Date.now();
  await request("/cages", "POST", {
    id: testCage10Id,
    roomId: "room-default",
    zoneId: "zone-default",
    area: "SPF区",
    rack: "T",
    capacity: 10,
    status: "active"
  }, API_KEYS.ADMIN);

  const projectRestrictedData = [{
    id: "ani-test-proj-restricted-" + Date.now(),
    strain: "C57BL/6J",
    cageId: testCage10Id,
    roomId: "room-default",
    zoneId: "zone-default",
    projectId: "proj-metabolism",
    sex: "male",
    birthDate: "2026-04-04",
    project: "代谢观察",
    keeper: "测试员"
  }];
  const projRestrictedRes = await request("/animals/import/preview", "POST", projectRestrictedData, API_KEYS.PROJECT_KEEPER);
  const projRestrictedCount = (projRestrictedRes.body.projectPermissionErrors || []).length;
  console.log(`项目权限错误数: ${projRestrictedCount}`);
  if (projRestrictedCount > 0) {
    const err = projRestrictedRes.body.projectPermissionErrors[0];
    console.log(`  项目ID: ${err.projectId} (${err.projectName})`);
    console.log(`  错误: ${err.errors[0].message}`);
    console.log(`  结果: ✓ 正确拦截无权限项目导入`);
  } else {
    console.log(`  结果: ✗ 未拦截无权限项目导入`);
  }

  const allowedProjectData = [{
    id: "ani-test-proj-allowed-" + Date.now(),
    strain: "C57BL/6J",
    cageId: testCage10Id,
    roomId: "room-default",
    zoneId: "zone-default",
    projectId: "proj-oncology",
    sex: "female",
    birthDate: "2026-04-05",
    project: "肿瘤研究",
    keeper: "测试员"
  }];
  const projAllowedRes = await request("/animals/import/preview", "POST", allowedProjectData, API_KEYS.PROJECT_KEEPER);
  console.log(`有权限项目的可导入数: ${projAllowedRes.body.importable}`);
  console.log(`结果: ${projAllowedRes.body.importable === 1 ? "✓ 正确，有权限项目可导入" : "✗ 错误"}`);

  console.log("\n11. 测试keeper账号房间权限限制（keeper-key-demo-001只能访问room-default，不能导入room-secondary）");
  console.log("-".repeat(60));

  const testCageId = "T-TEST-" + Date.now();
  console.log(`先创建笼位 ${testCageId}（属于 room-secondary / zone-transgenic）`);
  const createCageRes = await request("/cages", "POST", {
    id: testCageId,
    roomId: "room-secondary",
    zoneId: "zone-transgenic",
    area: "转基因区",
    rack: "T",
    capacity: 5,
    status: "active"
  }, API_KEYS.ADMIN);
  console.log(`创建笼位状态码: ${createCageRes.status}`);

  const roomRestrictedData = [{
    id: "ani-test-room-restricted-" + Date.now(),
    strain: "C57BL/6J",
    cageId: testCageId,
    sex: "male",
    birthDate: "2026-04-06",
    project: "转基因核心群",
    keeper: "测试员"
  }];
  const roomRestrictedRes = await request("/animals/import/preview", "POST", roomRestrictedData, API_KEYS.KEEPER_LQ);
  const roomRestrictedCount = (roomRestrictedRes.body.roomPermissionErrors || []).length;
  console.log(`房间权限错误数: ${roomRestrictedCount}`);
  if (roomRestrictedCount > 0) {
    const err = roomRestrictedRes.body.roomPermissionErrors[0];
    console.log(`  笼位ID: ${err.cageId}`);
    err.errors.forEach(e => console.log(`  错误: ${e.message}`));
    console.log(`  结果: ✓ 正确拦截无权限房间导入`);
  } else {
    console.log(`  结果: ✗ 未拦截无权限房间导入`);
  }

  console.log("\n验证 keeper-key-demo-002（有权访问 room-secondary）可以正常导入：");
  const roomAllowedData = [{
    id: "ani-test-room-allowed-" + Date.now(),
    strain: "C57BL/6J",
    cageId: testCageId,
    sex: "female",
    birthDate: "2026-04-07",
    project: "转基因核心群",
    keeper: "测试员"
  }];
  const roomAllowedRes = await request("/animals/import/preview", "POST", roomAllowedData, API_KEYS.KEEPER_ZY);
  console.log(`keeper-key-demo-002 可导入数: ${roomAllowedRes.body.importable}`);
  console.log(`结果: ${roomAllowedRes.body.importable === 1 ? "✓ 正确，有权限房间可导入" : "✗ 错误"}`);

  console.log("\n" + "=".repeat(60));
  console.log("测试完成");
  console.log("=".repeat(60));
}

runTests().catch((err) => {
  console.error("测试失败:", err.message);
  process.exit(1);
});
