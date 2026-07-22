import { useState } from "react";
import type { Diagnostic, ImportResult } from "../svgcanvas/SvgCanvasAdapter";
import type {
  MotionEditorProjectManifestV1,
  MotionEditorProjectBackupV1,
  MotionEditorSchemaCompatibility,
  ProductionPublishPlan,
} from "../project/manifest";
import { BUILT_IN_MANIFEST } from "../project/builtInProject";

export function useProjectDocument() {
  const [fingerprint, setFingerprint] = useState("");
  const [artwork, setArtwork] = useState("");
  const [manifest, setManifest] = useState<MotionEditorProjectManifestV1>(BUILT_IN_MANIFEST);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [savedHostSignature, setSavedHostSignature] = useState("");
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [compatibility, setCompatibility] = useState<MotionEditorSchemaCompatibility | null>(null);
  const [projectBackups, setProjectBackups] = useState<MotionEditorProjectBackupV1[]>([]);
  const [publishPlan, setPublishPlan] = useState<ProductionPublishPlan | null>(null);

  return {
    artwork, setArtwork,
    manifest, setManifest,
    fingerprint, setFingerprint,
    projectRoot, setProjectRoot,
    savedHostSignature, setSavedHostSignature,
    importResult, setImportResult,
    diagnostics, setDiagnostics,
    compatibility, setCompatibility,
    projectBackups, setProjectBackups,
    publishPlan, setPublishPlan,
  };
}
