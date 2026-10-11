/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["onnxruntime-node"],
    // Ship the ONNX model with the detector function, but only the Linux x64 runtime binary.
    outputFileTracingIncludes: { "/api/detect": ["./models/**"] },
    outputFileTracingExcludes: {
      "/api/detect": [
        "node_modules/onnxruntime-node/bin/napi-v*/darwin/**",
        "node_modules/onnxruntime-node/bin/napi-v*/win32/**",
        "node_modules/onnxruntime-node/bin/napi-v*/linux/arm64/**",
      ],
    },
  },
};
export default nextConfig;
