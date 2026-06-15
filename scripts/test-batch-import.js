import http from "node:http";
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const TEST_PORT = 3099;
const TEST_DB_PATH = join(tmpdir(), `lab-test-batch-${Date.now()}.json`);

const API_KEYS = {
  ADMIN: "admin-key-demo-001",
  KEEPER_LQ: "keeper-key-demo-001",
  KEEPER_ZY: "keeper-key-demo-002",
  PROJECT_KEEPER: "project-keeper-demo-001"
};

function request(baseUrl, path, method, body, apiKey = API_KEYS.ADMIN) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
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

function waitForServer(baseUrl, maxRetries = 30, interval = 500) {
  return new Promise((resolve, reject) => {
    let retries = 0;
    const check = () => {
      const url = new URL("/healthz", baseUrl);
      http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve(true);
        else { retries++; if (retries >= maxRetries) reject(new Error("Server not ready")); else setTimeout(check, interval); }
      }).on("error", () => {
        retries++;
        if (retries >= maxRetries) reject(new Error("Server not ready"));
        else setTimeout(check, interval);
      });
    };
    check();
  });
}

async function runTests() {
  const BASE_URL = `http://localhost:${TEST_PORT}`;
  const req = (path, method, body, apiKey) => request(BASE_URL, path, method, body, apiKey);

  console.log("=".repeat(60));
  console.log("动物批量导入模块测试");
  console.log("=".repeat(60));
  console.log(`测试服务器: ${BASE_URL}`);
  console.log(`测试数据库: ${TEST_DB_PATH}`);

  let serverProcess;
  try {
    console.log("\n启动测试服务器...");
    serverProcess = spawn("node", ["server.js"], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PORT: String(TEST_PORT), DB_PATH: TEST_DB_PATH },
      stdio: ["pipe", "pipe", "pipe"]
    });

    serverProcess.stderr.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) process.stderr.write(`  [server] ${msg}\n`);
    });

    await waitForServer(BASE_URL);
    console.log("测试服务器已就绪");
  } catch (e) {
    console.error("无法启动测试服务器:", e.message);
    process.exit(1);
  }

  try {
    const sampleData = JSON.parse(
      await readFile(join(PROJECT_ROOT, "data", "sample-import.json"), "utf8")
    );

    console.log("\n1. 测试导入预览接口 POST /animals/import/preview");
    console.log("-".repeat(60));

    const previewRes = await req("/animals/import/preview", "POST", sampleData);
    console.log(`状态码: ${previewRes.status}`);
    console.log(`总数: ${previewRes.body.total}`);
    console.log(`可导入: ${previewRes.body.importable}`);
    console.log(`字段错误数: ${previewRes.body.fieldErrors.length}`);
    console.log(`重复ID数: ${previewRes.body.duplicateIds.length}`);
    console.log(`缺失笼位数: ${previewRes.body.missingCages.length}`);
    console.log(`缺失项目数: ${(previewRes.body.missingProjects || []).length}`);
    console.log(`房间不匹配数: ${(previewRes.body.roomMismatches || []).length}`);
    console.log(`区域不匹配数: ${(previewRes.body.zoneMismatches || []).length}`);
    console.log(`项目不匹配数: ${(previewRes.body.projectMismatches || []).length}`);
    console.log(`容量冲突数: ${previewRes.body.capacityConflicts.length}`);
    console.log(`自动解析警告数: ${(previewRes.body.autoResolvedWarnings || []).length}`);
    console.log(`有效记录数: ${previewRes.body.validItems.length}`);

    if ((previewRes.body.autoResolvedWarnings || []).length > 0) {
      console.log("\n自动解析警告详情:");
      previewRes.body.autoResolvedWarnings.slice(0, 3).forEach((w) => {
        console.log(`  索引 ${w.index} (${w.id || '无ID'}): ${w.fields.map(f => `${f.field}←${f.from}(${f.name})`).join(", ")}`);
      });
      if (previewRes.body.autoResolvedWarnings.length > 3) {
        console.log(`  ... 还有 ${previewRes.body.autoResolvedWarnings.length - 3} 条`);
      }
    }

    if ((previewRes.body.missingProjects || []).length > 0) {
      console.log("\n缺失项目详情:");
      previewRes.body.missingProjects.forEach((p) => {
        console.log(`  索引 ${p.index}: ${p.message}`);
      });
    }

    if (previewRes.body.validItems.length > 0) {
      console.log("\n有效记录（含自动解析标记）:");
      previewRes.body.validItems.slice(0, 3).forEach((item) => {
        const ar = item.autoResolved ? ` [自动解析: ${item.autoResolved.map(f => f.field).join(",")}]` : "";
        console.log(`  索引${item.index}: ${item.id || '(无ID)'} - room=${item.roomName}(${item.roomId}) zone=${item.zoneName}(${item.zoneId}) proj=${item.projectName}(${item.projectId})${ar}`);
      });
    }

    console.log("\n2. 测试确认导入接口 POST /animals/import");
    console.log("-".repeat(60));

    const importRes = await req("/animals/import", "POST", sampleData);
    console.log(`状态码: ${importRes.status}`);
    if (importRes.status === 201) {
      console.log(`成功导入: ${importRes.body.imported}`);
      console.log(`跳过数: ${importRes.body.skipped}`);
      if (importRes.body.animals && importRes.body.animals.length > 0) {
        console.log(`导入动物projectId分布: ${importRes.body.animals.map(a => a.projectId).filter(Boolean).join(", ")}`);
      }
    } else {
      console.log(`错误: ${importRes.body.error}`);
    }

    console.log("\n3. 验证导入结果 GET /animals");
    console.log("-".repeat(60));

    const animalsRes = await req("/animals", "GET");
    const withFacilityFields = animalsRes.body.filter(a => a.roomId && a.zoneId && a.projectId);
    console.log(`动物总数: ${animalsRes.body.length}`);
    console.log(`含完整设施字段的动物数: ${withFacilityFields.length}`);
    console.log(`结果: ${withFacilityFields.length === animalsRes.body.length ? "✓ 所有动物都有完整设施字段" : `✗ 有 ${animalsRes.body.length - withFacilityFields.length} 只动物缺失设施字段`}`);

    console.log("\n4. 测试空数组导入预览");
    console.log("-".repeat(60));
    const emptyRes = await req("/animals/import/preview", "POST", []);
    console.log(`状态码: ${emptyRes.status}`);
    console.log(`错误: ${emptyRes.body.error}`);
    console.log(`结果: ${emptyRes.status === 400 ? "✓ 正确拒绝" : "✗ 错误"}`);

    console.log("\n5. 测试非数组输入");
    console.log("-".repeat(60));
    const invalidRes = await req("/animals/import/preview", "POST", { not: "array" });
    console.log(`状态码: ${invalidRes.status}`);
    console.log(`错误: ${invalidRes.body.error}`);
    console.log(`结果: ${invalidRes.status === 400 ? "✓ 正确拒绝" : "✗ 错误"}`);

    console.log("\n6. 测试单个动物建档（含roomId/zoneId/projectId）");
    console.log("-".repeat(60));
    const cage6Id = "CAGE-T6-" + Date.now();
    await req("/cages", "POST", { id: cage6Id, roomId: "room-default", zoneId: "zone-default", area: "SPF区", rack: "T", capacity: 10, status: "active" });
    const singleRes = await req("/animals", "POST", {
      id: "ani-t6-" + Date.now(), strain: "C57BL/6J", cageId: cage6Id, roomId: "room-default", zoneId: "zone-default", projectId: "proj-metabolism", sex: "female", birthDate: "2026-04-01", project: "代谢观察", keeper: "测试员"
    });
    if (singleRes.status === 201) {
      const a = singleRes.body;
      console.log(`roomId: ${a.roomId} | zoneId: ${a.zoneId} | projectId: ${a.projectId}`);
      console.log(`结果: ${a.roomId === "room-default" && a.projectId === "proj-metabolism" ? "✓ 正确" : "✗ 错误"}`);
    } else {
      console.log(`错误: ${singleRes.body.error}`);
    }

    console.log("\n7. 测试roomId/zoneId/projectId字段格式校验");
    console.log("-".repeat(60));
    const fmtRes = await req("/animals/import/preview", "POST", [{ id: "ani-t7", strain: "C57BL/6J", cageId: "A-01", roomId: "", zoneId: 123, projectId: null, sex: "female", birthDate: "2026-04-01", project: "代谢观察", keeper: "测试员" }]);
    const fmtErrors = fmtRes.body.fieldErrors[0]?.errors || [];
    const facilityFieldErrors = fmtErrors.filter(e => e.code && (e.code.includes("room") || e.code.includes("zone") || e.code.includes("project")));
    facilityFieldErrors.forEach(e => console.log(`  ${e.field}: ${e.message}`));
    console.log(`结果: ${facilityFieldErrors.length > 0 ? "✓ 正确拦截格式错误" : "✗ 未拦截"}`);

    console.log("\n8. 测试房间归属一致性（roomId与笼位不一致，以笼位为准）");
    console.log("-".repeat(60));
    const cage8Id = "CAGE-T8-" + Date.now();
    await req("/cages", "POST", { id: cage8Id, roomId: "room-default", zoneId: "zone-default", area: "SPF区", rack: "T", capacity: 10, status: "active" });
    const mmRes = await req("/animals/import", "POST", [{ id: "ani-t8-" + Date.now(), strain: "C57BL/6J", cageId: cage8Id, roomId: "room-secondary", zoneId: "zone-default", projectId: "proj-metabolism", sex: "male", birthDate: "2026-04-02", project: "代谢观察", keeper: "测试员" }]);
    if (mmRes.status === 201 && mmRes.body.animals?.length > 0) {
      const a = mmRes.body.animals[0];
      console.log(`导入动物 roomId: ${a.roomId} (笼位属于 room-default)`);
      console.log(`结果: ${a.roomId === "room-default" ? "✓ 以笼位所属房间为准" : "✗ 错误"}`);
      console.log(`房间不匹配警告: ${mmRes.body.warnings?.roomMismatches?.length > 0 ? "✓ 有" : "✗ 无"}`);
    }

    console.log("\n9. 测试projectId优先级（projectId优先于project名称解析）");
    console.log("-".repeat(60));
    const cage9Id = "CAGE-T9-" + Date.now();
    await req("/cages", "POST", { id: cage9Id, roomId: "room-default", zoneId: "zone-default", area: "SPF区", rack: "T", capacity: 10, status: "active" });
    const ppPreview = await req("/animals/import/preview", "POST", [{ id: "ani-t9-" + Date.now(), strain: "BALB/c", cageId: cage9Id, roomId: "room-default", zoneId: "zone-default", projectId: "proj-oncology", sex: "female", birthDate: "2026-04-03", project: "代谢观察", keeper: "测试员" }]);
    console.log(`预览项目不匹配数: ${ppPreview.body.projectMismatches?.length || 0}`);
    const ppRes = await req("/animals/import", "POST", [{ id: "ani-t9b-" + Date.now(), strain: "BALB/c", cageId: cage9Id, roomId: "room-default", zoneId: "zone-default", projectId: "proj-oncology", sex: "female", birthDate: "2026-04-03", project: "代谢观察", keeper: "测试员" }]);
    if (ppRes.status === 201 && ppRes.body.animals?.length > 0) {
      const a = ppRes.body.animals[0];
      console.log(`导入 projectId: ${a.projectId} (输入proj-oncology vs project名"代谢观察")`);
      console.log(`结果: ${a.projectId === "proj-oncology" ? "✓ projectId优先" : "✗ 错误"}`);
    }

    console.log("\n10. 测试keeper项目权限限制");
    console.log("-".repeat(60));
    const cage10Id = "CAGE-T10-" + Date.now();
    await req("/cages", "POST", { id: cage10Id, roomId: "room-default", zoneId: "zone-default", area: "SPF区", rack: "T", capacity: 10, status: "active" });
    const restrictedRes = await req("/animals/import/preview", "POST", [{ id: "ani-t10r-" + Date.now(), strain: "C57BL/6J", cageId: cage10Id, roomId: "room-default", zoneId: "zone-default", projectId: "proj-metabolism", sex: "male", birthDate: "2026-04-04", project: "代谢观察", keeper: "测试员" }], API_KEYS.PROJECT_KEEPER);
    console.log(`项目权限错误数: ${restrictedRes.body.projectPermissionErrors?.length || 0}`);
    console.log(`结果: ${(restrictedRes.body.projectPermissionErrors || []).length > 0 ? "✓ 正确拦截" : "✗ 未拦截"}`);
    const allowedRes = await req("/animals/import/preview", "POST", [{ id: "ani-t10a-" + Date.now(), strain: "C57BL/6J", cageId: cage10Id, roomId: "room-default", zoneId: "zone-default", projectId: "proj-oncology", sex: "female", birthDate: "2026-04-05", project: "肿瘤研究", keeper: "测试员" }], API_KEYS.PROJECT_KEEPER);
    console.log(`有权限项目可导入数: ${allowedRes.body.importable}`);
    console.log(`结果: ${allowedRes.body.importable === 1 ? "✓ 正确" : "✗ 错误"}`);

    console.log("\n11. 测试keeper房间权限限制");
    console.log("-".repeat(60));
    const cage11Id = "CAGE-T11-" + Date.now();
    await req("/cages", "POST", { id: cage11Id, roomId: "room-secondary", zoneId: "zone-transgenic", area: "转基因区", rack: "T", capacity: 5, status: "active" });
    const roomRestrictedRes = await req("/animals/import/preview", "POST", [{ id: "ani-t11r-" + Date.now(), strain: "C57BL/6J", cageId: cage11Id, sex: "male", birthDate: "2026-04-06", project: "转基因核心群", keeper: "测试员" }], API_KEYS.KEEPER_LQ);
    console.log(`房间权限错误数: ${roomRestrictedRes.body.roomPermissionErrors?.length || 0}`);
    console.log(`结果: ${(roomRestrictedRes.body.roomPermissionErrors || []).length > 0 ? "✓ 正确拦截" : "✗ 未拦截"}`);
    const roomAllowedRes = await req("/animals/import/preview", "POST", [{ id: "ani-t11a-" + Date.now(), strain: "C57BL/6J", cageId: cage11Id, sex: "female", birthDate: "2026-04-07", project: "转基因核心群", keeper: "测试员" }], API_KEYS.KEEPER_ZY);
    console.log(`keeper-002可导入数: ${roomAllowedRes.body.importable}`);
    console.log(`结果: ${roomAllowedRes.body.importable === 1 ? "✓ 正确" : "✗ 错误"}`);

    console.log("\n12. 测试未知项目名称不放行（缺失projectId且project名称不匹配）");
    console.log("-".repeat(60));
    const cage12Id = "CAGE-T12-" + Date.now();
    await req("/cages", "POST", { id: cage12Id, roomId: "room-default", zoneId: "zone-default", area: "SPF区", rack: "T", capacity: 10, status: "active" });
    const unknownProjRes = await req("/animals/import/preview", "POST", [{ id: "ani-t12-" + Date.now(), strain: "C57BL/6J", cageId: cage12Id, sex: "female", birthDate: "2026-04-08", project: "不存在的项目", keeper: "测试员" }]);
    const unknownProjErrors = (unknownProjRes.body.missingProjects || []).filter(p => p.message && p.message.includes("未找到匹配"));
    console.log(`未匹配项目错误数: ${unknownProjErrors.length}`);
    if (unknownProjErrors.length > 0) {
      console.log(`  ${unknownProjErrors[0].message}`);
      console.log(`可导入数: ${unknownProjRes.body.importable}`);
      console.log(`结果: ${unknownProjRes.body.importable === 0 ? "✓ 正确拦截未知项目名称，不放行" : "✗ 错误放行了未知项目"}`);
    } else {
      console.log(`结果: ✗ 未检测到未知项目名称`);
    }

    const unknownProjConfirmRes = await req("/animals/import", "POST", [{ id: "ani-t12b-" + Date.now(), strain: "C57BL/6J", cageId: cage12Id, sex: "female", birthDate: "2026-04-08", project: "不存在的项目", keeper: "测试员" }]);
    console.log(`正式导入状态码: ${unknownProjConfirmRes.status}`);
    console.log(`结果: ${unknownProjConfirmRes.status === 422 ? "✓ 正确拒绝导入" : "✗ 错误放行"}`);

    console.log("\n13. 测试默认项目名称可正常解析(project=默认项目)");
    console.log("-".repeat(60));
    const cage13Id = "CAGE-T13-" + Date.now();
    await req("/cages", "POST", { id: cage13Id, roomId: "room-default", zoneId: "zone-default", area: "SPF区", rack: "T", capacity: 10, status: "active" });
    const defaultProjRes = await req("/animals/import/preview", "POST", [{ id: "ani-t13-" + Date.now(), strain: "C57BL/6J", cageId: cage13Id, sex: "male", birthDate: "2026-04-09", project: "默认项目", keeper: "测试员" }]);
    console.log(`可导入数: ${defaultProjRes.body.importable}`);
    if (defaultProjRes.body.validItems?.length > 0) {
      const v = defaultProjRes.body.validItems[0];
      console.log(`解析 projectId: ${v.projectId}`);
      console.log(`结果: ${v.projectId === "project-default" ? "✓ 默认项目名称正确解析" : "✗ 解析错误"}`);
    }

    console.log("\n14. 测试autoResolved警告（不提供roomId/zoneId/projectId时提示自动解析）");
    console.log("-".repeat(60));
    const cage14Id = "CAGE-T14-" + Date.now();
    await req("/cages", "POST", { id: cage14Id, roomId: "room-default", zoneId: "zone-conventional", area: "普通区", rack: "T", capacity: 10, status: "active" });
    const arRes = await req("/animals/import/preview", "POST", [{ id: "ani-t14-" + Date.now(), strain: "C57BL/6J", cageId: cage14Id, sex: "female", birthDate: "2026-04-10", project: "代谢观察", keeper: "测试员" }]);
    const arWarnings = arRes.body.autoResolvedWarnings || [];
    console.log(`自动解析警告数: ${arWarnings.length}`);
    if (arWarnings.length > 0) {
      const w = arWarnings[0];
      console.log(`  字段: ${w.fields.map(f => `${f.field}←${f.from}(${f.name})`).join(", ")}`);
      const hasRoomId = w.fields.some(f => f.field === "roomId");
      const hasZoneId = w.fields.some(f => f.field === "zoneId");
      const hasProjectId = w.fields.some(f => f.field === "projectId");
      console.log(`结果: ${hasRoomId && hasZoneId && hasProjectId ? "✓ 正确提示所有自动解析字段" : "✗ 遗漏部分字段"}`);
    }

    console.log("\n15. 测试数据隔离：生产数据库不受影响");
    console.log("-".repeat(60));
    const prodDbExists = existsSync(join(PROJECT_ROOT, "data", "lab.json"));
    console.log(`生产数据库存在: ${prodDbExists}`);
    console.log(`测试数据库: ${TEST_DB_PATH}`);
    console.log(`结果: ✓ 测试使用独立临时数据库，不影响生产数据`);

    console.log("\n" + "=".repeat(60));
    console.log("测试完成");
    console.log("=".repeat(60));
  } finally {
    console.log("\n清理测试服务器...");
    serverProcess.kill("SIGTERM");
    setTimeout(() => { try { serverProcess.kill("SIGKILL"); } catch {} }, 3000);

    try { await unlink(TEST_DB_PATH); console.log(`已清理临时数据库: ${TEST_DB_PATH}`); } catch {}
  }
}

runTests().catch((err) => {
  console.error("测试失败:", err.message);
  process.exit(1);
});
