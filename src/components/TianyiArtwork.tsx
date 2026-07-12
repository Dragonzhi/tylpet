import artworkSource from "../assets/小洛宝.svg?raw";

export type PetExpression = "normal" | "blink" | "speak" | "sleep";

interface TianyiArtworkProps {
  expression: PetExpression;
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
      `(<g\\b[^>]*?)id="[^"]+"([^>]*?inkscape:label="${label}"[^>]*>)`,
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

const TianyiArtwork = ({ expression }: TianyiArtworkProps) => (
  <div
    aria-hidden="true"
    className={`tianyi-artwork expression-${expression}`}
    dangerouslySetInnerHTML={{ __html: artworkMarkup }}
  />
);

export default TianyiArtwork;
