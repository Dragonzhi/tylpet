import type { ProductionPublishPlan } from "../../project/manifest";

export interface PublishDialogProps {
  publishPlan: ProductionPublishPlan | null;
  onCancelPublish: () => Promise<void>;
  onCommitPublish: () => Promise<void>;
  hostBusy: boolean;
}

export function PublishDialog({
  publishPlan,
  onCancelPublish,
  onCommitPublish,
  hostBusy,
}: PublishDialogProps) {
  if (!publishPlan) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="publish-confirm" role="dialog" aria-modal="true" aria-labelledby="publish-title">
        <h2 id="publish-title">确认发布正式资源</h2>
        <p>目标目录固定为：</p>
        <code>{publishPlan.targetDirectory}</code>
        <dl>
          <dt>当前 signature</dt><dd><code>{publishPlan.currentSignature}</code></dd>
          <dt>候选 signature</dt><dd><code>{publishPlan.candidateSignature}</code></dd>
        </dl>
        <div className="publish-diff">
          <strong>变更摘要</strong>
          <p>Rig：{publishPlan.diff.rigChanged ? "已修改" : "无变化"}</p>
          <p>新增 Clip：{publishPlan.diff.addedClips.join("、") || "无"}</p>
          <p>删除 Clip：{publishPlan.diff.removedClips.join("、") || "无"}</p>
          <p>修改 Clip：{publishPlan.diff.changedClips.join("、") || "无"}</p>
        </div>
        <p className="publish-warning">提交将替换正式 rig 与 motions。请核对固定目标和 signature。</p>
        <div className="publish-actions">
          <button type="button" onClick={() => void onCancelPublish()} disabled={hostBusy}>取消</button>
          <button type="button" className="danger" onClick={() => void onCommitPublish()} disabled={hostBusy}>确认提交</button>
        </div>
      </section>
    </div>
  );
}
