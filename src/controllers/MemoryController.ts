import { invoke } from "@tauri-apps/api/core";
import type {
  BondAwardResponse,
  MemoryCategory,
  MemoryLoadResponse,
  MemorySnapshot,
} from "../domain/memory/types";
import type { MemoryProposePayload } from "../domain/actions/types";

export class MemoryController {
  getSnapshot(): Promise<MemoryLoadResponse> {
    return invoke<MemoryLoadResponse>("memory_get_snapshot");
  }

  addEntry(content: string, category: MemoryCategory): Promise<MemorySnapshot> {
    return invoke<MemorySnapshot>("memory_add_entry", {
      request: { id: createId("memory"), content, category },
    });
  }

  acceptProposal(
    proposal: MemoryProposePayload,
    acceptance: "confirmed" | "explicit_request",
  ): Promise<MemorySnapshot> {
    return invoke<MemorySnapshot>("memory_accept_proposal", {
      request: { id: createId("memory"), ...proposal, acceptance },
    });
  }

  updateEntry(id: string, content: string, category: MemoryCategory): Promise<MemorySnapshot> {
    return invoke<MemorySnapshot>("memory_update_entry", { request: { id, content, category } });
  }

  deleteEntry(id: string): Promise<MemorySnapshot> {
    return invoke<MemorySnapshot>("memory_delete_entry", { id });
  }

  clearAll(): Promise<MemorySnapshot> {
    return invoke<MemorySnapshot>("memory_clear_all");
  }

  recordCompletedInteraction(interactionId: string, occurredAtMs = Date.now()): Promise<BondAwardResponse> {
    return invoke<BondAwardResponse>("memory_record_interaction", {
      request: {
        interactionId,
        occurredAtMs,
        localDate: formatLocalDate(new Date(occurredAtMs)),
      },
    });
  }

  exportToDownloads(): Promise<string> {
    return invoke<string>("memory_export");
  }
}

function createId(prefix: string): string {
  const suffix = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
