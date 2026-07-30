import { Mesh, Program, Plane, Texture, Transform } from "ogl";
import type { OGLRenderingContext } from "ogl";
import { fragmentShader, vertexShader } from "../Shader/galleryShader";

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
  private abortController = new AbortController();
  private currentImage: HTMLImageElement | null = null;

  constructor(options: CardMeshOptions) {
    const { gl, geometry, parent, index, src, cardWidth, cardHeight, baseX } = options;

    this.index = index;
    this.src = src;
    this.baseX = baseX;
    this.cardWidth = cardWidth;
    this.cardHeight = cardHeight;

    this.texture = new Texture(gl, {
      generateMipmaps: false,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      anisotropy: 16,
    });

    this.program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        tMap: { value: this.texture },
        uPlaneSizes: { value: new Float32Array([cardWidth, cardHeight]) },
        uImageSizes: { value: new Float32Array([800, 1000]) },
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
    this.currentImage = img;
    img.crossOrigin = "anonymous";
    img.src = this.src;

    const { signal } = this.abortController;

    img.addEventListener(
      "load",
      () => {
        this.texture.image = img;
        this.program.uniforms.uImageSizes.value[0] = img.naturalWidth || 800;
        this.program.uniforms.uImageSizes.value[1] = img.naturalHeight || 1000;
        this.isTextureLoaded = true;
        this.isTextureLoading = false;
        this.currentImage = null;
      },
      { signal }
    );

    img.addEventListener(
      "error",
      () => {
        this.isTextureLoading = false;
        this.currentImage = null;
        console.error(`[CardMesh] Failed to load texture image: ${this.src}`);
      },
      { signal }
    );
  }

  public updateSize(cardWidth: number, cardHeight: number, baseX: number) {
    this.cardWidth = cardWidth;
    this.cardHeight = cardHeight;
    this.baseX = baseX;
    this.program.uniforms.uPlaneSizes.value[0] = cardWidth;
    this.program.uniforms.uPlaneSizes.value[1] = cardHeight;
  }

  public setTransform(
    x: number,
    y: number,
    z: number,
    scaleX: number,
    scaleY: number,
    opacity: number,
    parallaxX: number
  ) {
    this.mesh.position.set(x, y, z);
    this.mesh.scale.set(scaleX, scaleY, 1.0);

    this.program.uniforms.uOpacity.value = opacity;

    const clampedParallax = Math.min(Math.max(parallaxX, -1.2), 1.2);
    this.program.uniforms.uParallaxX.value = clampedParallax;

    const uPlane = this.program.uniforms.uPlaneSizes.value;
    uPlane[0] = this.cardWidth * scaleX;
    uPlane[1] = this.cardHeight * scaleY;
  }

  public setVelocity(v: number) {
    this.program.uniforms.uVelocity.value = Math.min(Math.max(v, -10.0), 10.0);
  }

  public destroy() {
    this.abortController.abort();

    if (this.currentImage) {
      this.currentImage.src = "";
      this.currentImage = null;
    }

    const gl = (this.program as any).gl as WebGLRenderingContext | OGLRenderingContext | undefined;
    if (gl) {
      if (this.texture?.texture) {
        try {
          gl.deleteTexture(this.texture.texture);
        } catch { }
      }
      if ((this.program as any).program) {
        try {
          gl.deleteProgram((this.program as any).program);
        } catch { }
      }
    }

    this.mesh.setParent(null);
  }
}