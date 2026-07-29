import { Mesh, Program, Plane, Texture, Transform } from "ogl";
import type { OGLRenderingContext } from "ogl";
import { vertexShader, fragmentShader } from "./shaders/galleryShader";

export interface CardMeshOptions {
  gl: OGLRenderingContext;
  geometry: Plane;
  parent: Transform;
  index: number;
  src: string;
  cardWidth: number;
  cardHeight: number;
  baseX: number;
}

export class CardMesh {
  public index: number;
  public mesh: Mesh;
  public program: Program;
  public texture: Texture;
  public baseX: number;
  public cardWidth: number;
  public cardHeight: number;
  public isTextureLoaded = false;
  public isTextureLoading = false;
  private src: string;

  constructor(options: CardMeshOptions) {
    const { gl, geometry, parent, index, src, cardWidth, cardHeight, baseX } = options;

    this.index = index;
    this.src = src;
    this.baseX = baseX;
    this.cardWidth = cardWidth;
    this.cardHeight = cardHeight;

    this.texture = new Texture(gl, {
      generateMipmaps: true,
      minFilter: gl.LINEAR_MIPMAP_LINEAR,
      magFilter: gl.LINEAR,
      anisotropy: 16,
    });

    this.program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        tMap: { value: this.texture },
        uPlaneSizes: { value: [cardWidth, cardHeight] },
        uImageSizes: { value: [800, 1000] },
        uParallaxX: { value: 0 },
        uVelocity: { value: 0 },
        uOpacity: { value: 1.0 },
        uOffsetZ: { value: 0.0 },
      },
      transparent: true,
      depthTest: false,
    });

    this.mesh = new Mesh(gl, { geometry, program: this.program });
    this.mesh.position.set(baseX, 0, 0);
    this.mesh.setParent(parent);
  }

  public loadTexture() {
    if (this.isTextureLoaded || this.isTextureLoading) return;
    this.isTextureLoading = true;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = this.src;
    img.onload = () => {
      this.texture.image = img;
      this.program.uniforms.uImageSizes.value = [img.naturalWidth || 800, img.naturalHeight || 1000];
      this.isTextureLoaded = true;
      this.isTextureLoading = false;
    };
    img.onerror = () => {
      this.isTextureLoading = false;
      console.error(`[CardMesh] Failed to load texture image: ${this.src}`);
    };
  }

  public updateSize(cardWidth: number, cardHeight: number, baseX: number) {
    this.cardWidth = cardWidth;
    this.cardHeight = cardHeight;
    this.baseX = baseX;
    this.program.uniforms.uPlaneSizes.value = [cardWidth, cardHeight];
    this.mesh.scale.set(1, 1, 1);
  }

  public setTransform(
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleY: number,
    opacity: number,
    parallaxX: number,
    lerpFactor = 0.2,
  ) {
    const SNAP = 0.005; // Hard snap threshold: below 1/200 pixel

    // Position X
    const dx = x - this.mesh.position.x;
    this.mesh.position.x = Math.abs(dx) < SNAP ? x : this.mesh.position.x + dx * lerpFactor;

    // Position Y
    const dy = y - this.mesh.position.y;
    this.mesh.position.y = Math.abs(dy) < SNAP ? y : this.mesh.position.y + dy * lerpFactor;

    // Position Z
    const dz = z - this.mesh.position.z;
    this.mesh.position.z = Math.abs(dz) < SNAP ? z : this.mesh.position.z + dz * lerpFactor;

    // Scale X
    const dsx = scaleX - this.mesh.scale.x;
    this.mesh.scale.x = Math.abs(dsx) < SNAP ? scaleX : this.mesh.scale.x + dsx * lerpFactor;

    // Scale Y
    const dsy = scaleY - this.mesh.scale.y;
    this.mesh.scale.y = Math.abs(dsy) < SNAP ? scaleY : this.mesh.scale.y + dsy * lerpFactor;

    // Opacity
    const dOp = opacity - this.program.uniforms.uOpacity.value;
    this.program.uniforms.uOpacity.value = Math.abs(dOp) < SNAP ? opacity : this.program.uniforms.uOpacity.value + dOp * lerpFactor;

    // ParallaxX
    const dPx = parallaxX - this.program.uniforms.uParallaxX.value;
    this.program.uniforms.uParallaxX.value = Math.abs(dPx) < SNAP ? parallaxX : this.program.uniforms.uParallaxX.value + dPx * lerpFactor;

    // Plane sizes (derived value, always recalculate)
    this.program.uniforms.uPlaneSizes.value = [
      this.cardWidth * this.mesh.scale.x,
      this.cardHeight * this.mesh.scale.y,
    ];
  }

  public setVelocity(v: number) {
    this.program.uniforms.uVelocity.value = v;
  }

  public destroy() {
    const gl = (this.program as any).gl as WebGLRenderingContext | undefined;
    if (gl && this.texture?.texture) {
      gl.deleteTexture(this.texture.texture);
    }
    this.mesh.setParent(null);
  }
}
