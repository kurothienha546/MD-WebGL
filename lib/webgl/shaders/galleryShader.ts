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

  vec2 getCoverUv(vec2 uv, vec2 planeSize, vec2 imageSize) {
    vec2 ratio = vec2(
      min((planeSize.x / planeSize.y) / (imageSize.x / imageSize.y), 1.0),
      min((planeSize.y / planeSize.x) / (imageSize.y / imageSize.x), 1.0)
    );
    return vec2(
      uv.x * ratio.x + (1.0 - ratio.x) * 0.5,
      uv.y * ratio.y + (1.0 - ratio.y) * 0.5
    );
  }

  void main() {
    vec2 uv = getCoverUv(vUv, uPlaneSizes, uImageSizes);

    // Parallax shift in X direction (1.15x scale margin to prevent dark edges)
    vec2 parallaxUv = (uv - 0.5) / 1.15 + 0.5;
    parallaxUv.x += uParallaxX * 0.12;

    vec4 color = texture2D(tMap, parallaxUv);
    color.a *= uOpacity;

    gl_FragColor = color;
  }
`;
