declare module "gifenc" {
  function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: { palette?: number[][]; delay?: number; transparent?: boolean }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  function quantize(rgba: Uint8Array, maxColors: number, options?: { format?: string }): number[][];
  function applyPalette(rgba: Uint8Array, palette: number[][], format?: string): Uint8Array;

  const _default: {
    GIFEncoder: typeof GIFEncoder;
    quantize: typeof quantize;
    applyPalette: typeof applyPalette;
  };
  export default _default;
}
