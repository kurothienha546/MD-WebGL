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
  uScale?: number;
  parallaxSensitivity?: number;
}


export class CardMesh {
  public index: number;
  public mesh: Mesh;
  public program: Program;
  public texture: Texture;
  public baseX: number;
  public cardWidth: number;
  public cardHeight: number;
  public uScale: number;
  public parallaxSensitivity: number;
  public isTextureLoaded = false;
  public isTextureLoading = false;

  private src: string;
  private abortController = new AbortController();
  private currentImage: HTMLImageElement | null = null;

  constructor(options: CardMeshOptions) {
    const {
      gl,
      geometry,
      parent,
      index,
      src,
      cardWidth,
      cardHeight,
      baseX,
      uScale = 1.08,
      parallaxSensitivity = 0.6,
    } = options;

    this.index = index;
    this.src = src;
    this.baseX = baseX;
    this.cardWidth = cardWidth;
    this.cardHeight = cardHeight;
    this.uScale = uScale;
    this.parallaxSensitivity = parallaxSensitivity;

    const margin = (1.0 - 1.0 / Math.max(this.uScale, 1.0)) / 2.0;

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
        uQuadRes: { value: new Float32Array([cardWidth, cardHeight]) },
        uImageRes: { value: new Float32Array([800, 1000]) },
        uScale: { value: this.uScale },
        uParallaxX: { value: 0 },
        uMaxParallax: { value: margin },
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

  public updateParallaxBounds() {
    const safeScale = Math.max(this.uScale, 1.0);
    const margin = (1.0 - 1.0 / safeScale) / 2.0;
    this.program.uniforms.uScale.value = safeScale;
    this.program.uniforms.uMaxParallax.value = Math.max(0, margin);
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
        this.program.uniforms.uImageRes.value[0] = img.naturalWidth || 800;
        this.program.uniforms.uImageRes.value[1] = img.naturalHeight || 1000;
        this.updateParallaxBounds();
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
    this.program.uniforms.uQuadRes.value[0] = cardWidth;
    this.program.uniforms.uQuadRes.value[1] = cardHeight;
    this.updateParallaxBounds();
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

    const clampedParallax = Math.min(Math.max(parallaxX * this.parallaxSensitivity, -1.0), 1.0);
    this.program.uniforms.uParallaxX.value = clampedParallax;

    const uQuad = this.program.uniforms.uQuadRes.value;
    uQuad[0] = this.cardWidth * scaleX;
    uQuad[1] = this.cardHeight * scaleY;
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