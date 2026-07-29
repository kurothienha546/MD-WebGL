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
    this.mesh.position.x += (x - this.mesh.position.x) * lerpFactor;
    this.mesh.position.y += (y - this.mesh.position.y) * lerpFactor;
    this.mesh.position.z += (z - this.mesh.position.z) * lerpFactor;

    this.mesh.scale.x += (scaleX - this.mesh.scale.x) * lerpFactor;
    this.mesh.scale.y += (scaleY - this.mesh.scale.y) * lerpFactor;

    this.program.uniforms.uOpacity.value += (opacity - this.program.uniforms.uOpacity.value) * lerpFactor;
    this.program.uniforms.uParallaxX.value += (parallaxX - this.program.uniforms.uParallaxX.value) * lerpFactor;

    this.program.uniforms.uPlaneSizes.value = [
      this.cardWidth * this.mesh.scale.x,
      this.cardHeight * this.mesh.scale.y,
    ];
  }

  public setVelocity(v: number) {
    this.program.uniforms.uVelocity.value = v;
  }

  public destroy() {
    const gl = (this.program as any).gl;
    if (this.texture && this.texture.texture && gl) {
      gl.deleteTexture(this.texture.texture);
    }
    (this.program as any)?.remove?.();
    (this.mesh as any)?.setParent?.(null);
  }
}
