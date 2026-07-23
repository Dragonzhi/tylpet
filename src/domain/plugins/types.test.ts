import { describe, expect, it } from "vitest";
import { parseInstalledPlugins, pluginGrants } from "./types";

const installed = {
  id: "dev-agent-hooks",
  name: "开发 Agent 状态桥",
  version: "0.1.0",
  enabled: true,
  observationEvents: ["dev-agent.status"],
  maxSensitivity: "status",
  credentialPath: "C:\\plugin\\credential.v1.json",
};

describe("plugin grants", () => {
  it("只为启用插件生成精确来源授权", () => {
    const plugins = parseInstalledPlugins([installed, { ...installed, id: "off", enabled: false }]);
    expect(pluginGrants(plugins)).toEqual([{
      source: { kind: "plugin", id: "dev-agent-hooks" },
      eventTypes: ["dev-agent.status"],
      maxSensitivity: "status",
    }]);
  });

  it("拒绝未知事件和损坏的原生返回值", () => {
    expect(parseInstalledPlugins([{ ...installed, observationEvents: ["shell.output"] }])).toEqual([]);
    expect(parseInstalledPlugins({ plugins: [installed] })).toEqual([]);
  });
});
