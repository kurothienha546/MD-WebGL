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
  uniform vec2 uQuadRes;
  uniform vec2 uImageRes;
  uniform float uScale;
  uniform float uParallaxX;
  uniform float uMaxParallax;
  uniform float uOpacity;

  varying vec2 vUv;

  void main() {
    // 1. Chống lỗi chia cho 0 khi Quad hoặc Image kích thước bằng 0
    vec2 quadRes = max(uQuadRes, vec2(0.001));
    vec2 imageRes = max(uImageRes, vec2(0.001));

    // 2. Tính toán Aspect Ratio (Object-Fit Cover)
    vec2 st = quadRes / imageRes;
    float maxRatio = max(st.x, st.y);
    vec2 coverScale = quadRes / (imageRes * maxRatio);

    // 3. Tỷ lệ zoom an toàn uScale tạo biên độ cho hiệu ứng Parallax
    float safeScale = max(uScale, 1.0);
    vec2 uvScale = coverScale / safeScale;

    vec2 uv = (vUv - 0.5) * uvScale + 0.5;

    // 4. Khống chế Parallax X theo biên độ an toàn uMaxParallax
    float marginX = (1.0 - 1.0 / safeScale) / 2.0;
    float shiftX = uParallaxX * uMaxParallax;

    // Giữ UV không vượt khỏi khoảng an toàn [marginX, 1.0 - marginX]
    uv.x = clamp(uv.x + shiftX, marginX, 1.0 - marginX);
    uv.y = clamp(uv.y, 0.0, 1.0);

    vec4 color = texture2D(tMap, uv);
    color.a *= uOpacity;

    gl_FragColor = color;
  }
`;