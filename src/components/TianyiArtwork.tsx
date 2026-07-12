import artworkSource from "../assets/小洛宝.svg?raw";
import { memo, useLayoutEffect, useRef } from "react";

export type PetExpression = "normal" | "blink" | "speak" | "sleep";
export type PetAction = "none" | "wave";

interface TianyiArtworkProps {
  expression: PetExpression;
  action: PetAction;
}

const animatedLayerLabels = [
  "character",
  "hair_tail_left",
  "hair_tail_right",
  "arm_left",
  "arm_right",
  "leg_left",
  "leg_right",
  "body",
  "white_cloth",
  "blue_decoration",
  "black_decoration",
  "tie",
  "head",
  "hair_back",
  "braided_hair",
  "celestial_updo",
  "hair_accessory",
  "face",
  "ears",
  "rouge",
  "eye_left",
  "eye_right",
  "mouth",
  "hair_front",
  "pivot_arm_left",
  "pivot_arm_right",
  "pivot_leg_left",
  "pivot_leg_right",
  "pivot_head",
] as const;

const prepareArtwork = () => {
  let svg = artworkSource
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<!--[^]*?-->/g, "")
    .replace(/\swidth="[^"]*"/, "")
    .replace(/\sheight="[^"]*"/, "");

  for (const label of animatedLayerLabels) {
    const semanticId = label.replace(/_/g, "-");
    const layerPattern = new RegExp(
      `(<(?:g|ellipse|circle|rect)\\b[^>]*?)id="[^"]+"([^>]*?inkscape:label="${label}"[^>]*>)`,
    );
    svg = svg.replace(layerPattern, `$1id="${semanticId}"$2`);
  }

  svg = svg
    .replace(
      /<svg\b/,
      '<svg class="tianyi-svg" aria-hidden="true" focusable="false"',
    )
    .replace(/(<svg\b[^>]*>)/, '$1<g id="motion-root" class="pet-breathe">')
    .replace(/<\/svg>\s*$/, "</g></svg>");

  return svg;
};

// 本地、受版本控制的 SVG 在构建时内联，以便 CSS 直接控制各动画图层。
const artworkMarkup = prepareArtwork();

// SVG DOM 必须在眨眼等表情更新时保持不变，否则持续动画会从头开始。
const StaticArtwork = memo(() => (
  <div
    className="tianyi-svg-host"
    dangerouslySetInnerHTML={{ __html: artworkMarkup }}
  />
));

interface ArmRig {
  foreground: SVGGElement;
  motion: SVGGElement;
  originalNextSibling: ChildNode | null;
  originalParent: ParentNode;
}

const TianyiArtwork = ({ expression, action }: TianyiArtworkProps) => {
  const artworkElement = useRef<HTMLDivElement>(null);
  const armRig = useRef<ArmRig | null>(null);

  useLayoutEffect(() => {
    const host = artworkElement.current;
    const svg = host?.querySelector<SVGSVGElement>(".tianyi-svg");
    const character = svg?.querySelector<SVGGElement>("#character");
    const arm = svg?.querySelector<SVGGElement>("#arm-right");
    const pivot = svg?.querySelector<SVGGraphicsElement>("#pivot-arm-right");
    if (!svg || !character || !arm || !pivot || !arm.parentNode) return;

    const originalParent = arm.parentNode;
    const originalNextSibling = arm.nextSibling;
    const svgNamespace = "http://www.w3.org/2000/svg";
    const motion = document.createElementNS(svgNamespace, "g");
    const foreground = document.createElementNS(svgNamespace, "g");
    motion.id = "arm-right-motion";
    foreground.id = "action-foreground";
    motion.style.animation = "none";

    originalParent.insertBefore(motion, arm);
    motion.appendChild(arm);
    character.appendChild(foreground);

    // motion 是 character 的子节点，因此 pivot 必须换算到相同的父级坐标系。
    const pivotBounds = pivot.getBBox();
    const pivotPoint = svg.createSVGPoint();
    pivotPoint.x = pivotBounds.x + pivotBounds.width / 2;
    pivotPoint.y = pivotBounds.y + pivotBounds.height / 2;
    const pivotScreenMatrix = pivot.getScreenCTM();
    const parentScreenMatrix = (
      originalParent as SVGGraphicsElement
    ).getScreenCTM?.();
    if (pivotScreenMatrix && parentScreenMatrix) {
      const screenPoint = pivotPoint.matrixTransform(pivotScreenMatrix);
      const parentPoint = screenPoint.matrixTransform(
        parentScreenMatrix.inverse(),
      );
      const viewBox = svg.viewBox.baseVal;
      const originX = ((parentPoint.x - viewBox.x) / viewBox.width) * 100;
      const originY = ((parentPoint.y - viewBox.y) / viewBox.height) * 100;
      motion.style.transformBox = "view-box";
      motion.style.transformOrigin = `${originX}% ${originY}%`;
    }
    motion.style.removeProperty("animation");

    armRig.current = {
      foreground,
      motion,
      originalNextSibling,
      originalParent,
    };

    return () => {
      originalParent.insertBefore(arm, originalNextSibling);
      motion.remove();
      foreground.remove();
      armRig.current = null;
    };
  }, [artworkMarkup]);

  useLayoutEffect(() => {
    const rig = armRig.current;
    if (!rig) return;

    if (action === "wave") {
      rig.foreground.appendChild(rig.motion);
      return;
    }

    rig.originalParent.insertBefore(rig.motion, rig.originalNextSibling);
  }, [action]);

  return (
    <div
      ref={artworkElement}
      aria-hidden="true"
      className={`tianyi-artwork expression-${expression}`}
    >
      <StaticArtwork />
    </div>
  );
};

export default TianyiArtwork;
