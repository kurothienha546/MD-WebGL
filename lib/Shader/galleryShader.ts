export const vertexShader = /* glsl */ `
  attribute vec3 position;
  attribute vec2 uv;

  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;

  uniform float uVelocity;
  uniform float uOffsetZ;

  varying vec2 vUv;

  #define PI 3.14159265359

  void main() {
    vUv = uv;
    vec3 pos = position;

    // Liquid speed bending along Z axis based on velocity
    float bend = sin(uv.x * PI) * uVelocity * 0.18;
    pos.z += bend + uOffsetZ;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

export const fragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D tMap;
  uniform vec2 uPlaneSizes;
  uniform vec2 uImageSizes;
  uniform float uParallaxX;
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    // 1. Chống lỗi chia cho 0 khi Plane scale về 0 lúc đóng/mở Lightbox
    vec2 planeSize = max(uPlaneSizes, vec2(0.001));
    vec2 imageSize = max(uImageSizes, vec2(0.001));

    // 2. Cover-fit chuẩn tỷ lệ 1:1 (bỏ hoàn toàn 1.15x zoom)
    vec2 s = planeSize / imageSize;
    float maxScale = max(s.x, s.y);
    vec2 uvScale = planeSize / (imageSize * maxScale);
    
    vec2 uv = (vUv - 0.5) * uvScale + 0.5;
    
    // 3. Parallax shift trực tiếp
    uv.x += uParallaxX * 0.12;

    vec4 color = texture2D(tMap, uv);
    color.a *= uOpacity;

    gl_FragColor = color;
  }
`;