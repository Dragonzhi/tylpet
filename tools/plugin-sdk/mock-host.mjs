import { readFile } from "node:fs/promises";

const [manifestPath, eventType = "dev-agent.status", state = "completed"] = process.argv.slice(2);
if (!manifestPath) fail("用法：node tools/plugin-sdk/mock-host.mjs <ltypet.plugin.json> [eventType] [state]");

let manifest;
try {
  manifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  fail(`无法读取 manifest：${error instanceof Error ? error.message : String(error)}`);
}

const knownEvents = new Set(["dev-agent.status", "media.playback"]);
const states = {
  "dev-agent.status": new Set(["session_started", "working", "waiting_for_user", "completed", "failed", "stopped"]),
  "media.playback": new Set(["playing", "paused", "stopped"]),
};
if (manifest?.schemaVersion !== 1 || manifest?.entry?.type !== "observation-source") {
  fail("manifest 不是受支持的声明式 v1 observation-source");
}
if (!Array.isArray(manifest?.permissions?.observationEvents)
  || !manifest.permissions.observationEvents.every((value) => knownEvents.has(value))) {
  fail("manifest 包含未知观察事件");
}
if (!manifest.permissions.observationEvents.includes(eventType)) {
  fail(`插件未声明事件：${eventType}`);
}
if (!states[eventType]?.has(state)) fail(`state 不属于 ${eventType} 的 v1 白名单`);

console.log(JSON.stringify({
  accepted: true,
  source: { kind: "plugin", id: manifest.id },
  event: { type: eventType, sensitivity: "status", payload: { state } },
}, null, 2));

function fail(message) {
  console.error(`[Mock Host] ${message}`);
  process.exit(2);
}
