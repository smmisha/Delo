// Delo desktop material. Explicit monitor texture; no compositor hooks.
cbuffer Params : register(b0) {
    float4 geometry; // width, height, radius, optical band
    float4 state;    // refraction enabled, grid shift, dark theme, displacement px
};
Texture2D sourceTexture : register(t0);
SamplerState sourceSampler : register(s0);

float4 VS(uint id : SV_VertexID) : SV_Position {
    float2 p = float2((id << 1) & 2, id & 2);
    return float4(p * float2(2, -2) + float2(-1, 1), 0, 1);
}
// Separable Gaussian: continuous coverage avoids the repeated text outlines made
// by the old sparse two-ring samples. The optical pass still displaces this image.
float4 Blur(float2 p, float2 direction) {
    float scale = geometry.z / 36.0;
    float2 uv = p / geometry.xy;
    float4 color = 0;
    float total = 0;
    [unroll] for (int i = -12; i <= 12; i++) {
        float weight = exp(-float(i * i) / 50.0);
        color += sourceTexture.SampleLevel(sourceSampler,
            uv + direction * float(i) * scale / geometry.xy, 0) * weight;
        total += weight;
    }
    return color / total;
}
float4 BlurH(float4 p : SV_Position) : SV_Target { return Blur(p.xy, float2(1,0)); }
float4 BlurV(float4 p : SV_Position) : SV_Target { return Blur(p.xy, float2(0,1)); }
float4 Glass(float4 position : SV_Position) : SV_Target {
    float2 p = position.xy;
    float2 centered = p - geometry.xy * 0.5;
    float2 q = abs(centered) - (geometry.xy * 0.5 - 8.0 - geometry.z);
    float distance = length(max(q, 0)) + min(max(q.x, q.y), 0) - geometry.z;
    float2 normal;
    if (max(q.x, q.y) > 0) normal = normalize(max(q, 0) + 0.00001) * sign(centered);
    else normal = (q.x > q.y) ? float2(sign(centered.x), 0) : float2(0, sign(centered.y));
    // Preserve the verified boundary-shaped inward refraction.
    float band = saturate(1.0 + distance / geometry.w);
    float2 offset = -normal * state.w * band * band * state.x;
    float2 uv = clamp((p + offset) / geometry.xy, 0.5 / geometry.xy, 1 - 0.5 / geometry.xy);
    float alpha = saturate(0.5 - distance);
    float3 rgb = sourceTexture.SampleLevel(sourceSampler, uv, 0).rgb;
    float3 tint=lerp(float3(244,248,252),float3(24,35,50),state.z)/255.0;
    // Preserve the accepted matte tint and optical rim.
    rgb=lerp(rgb,tint,lerp(0.72,0.76,state.z));
    float rim=exp(-abs(distance+0.8)*0.8);
    float highlight=saturate(dot(normal,normalize(float2(-0.6,-1.0))))*rim;
    rgb=saturate(rgb+highlight*lerp(0.20,0.12,state.z));
    return float4(rgb * alpha, alpha); // premultiplied for DirectComposition
}
