// Delo feasibility shader. Original code; explicit source texture, no compositor hooks.
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
float4 Grid(float4 position : SV_Position) : SV_Target {
    float2 cell = fmod(position.xy + state.y, 25.0);
    float ink = step(min(cell.x, cell.y), 2.5);
    float3 bg = lerp(float3(205,227,239), float3(35,47,62), state.z) / 255.0;
    float3 inkColor = lerp(float3(35,75,105), float3(153,192,210), state.z) / 255.0;
    return float4(lerp(bg, inkColor, ink), 1);
}
float4 Glass(float4 position : SV_Position) : SV_Target {
    float2 p = position.xy;
    float2 centered = p - geometry.xy * 0.5;
    float2 q = abs(centered) - (geometry.xy * 0.5 - 8.0 - geometry.z);
    float distance = length(max(q, 0)) + min(max(q.x, q.y), 0) - geometry.z;
    float2 normal;
    if (max(q.x, q.y) > 0) normal = normalize(max(q, 0) + 0.00001) * sign(centered);
    else normal = (q.x > q.y) ? float2(sign(centered.x), 0) : float2(0, sign(centered.y));
    // A smooth boundary-shaped inward displacement. Diagnostic lens, not final optical model.
    float band = saturate(1.0 + distance / geometry.w);
    float2 offset = -normal * state.w * band * band * state.x;
    float2 uv = clamp((p + offset) / geometry.xy, 0.5 / geometry.xy, 1 - 0.5 / geometry.xy);
    float alpha = saturate(0.5 - distance);
    float3 rgb = sourceTexture.SampleLevel(sourceSampler, uv, 0).rgb;
    return float4(rgb * alpha, alpha); // premultiplied for DirectComposition
}
