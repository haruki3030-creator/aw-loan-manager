import { NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req) {
  try {
    const { imageBase64, mimeType } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });

    const prompt = "이 이미지에서 텍스트를 전부 그대로 추출해주세요. 카카오톡 대화 캡처 또는 대출 접수 문서 이미지일 수 있습니다. 원본 텍스트를 형식 변경 없이, 줄바꿈 포함해서 추출해주세요. 설명이나 부가 문구 없이 텍스트만 출력하세요.";

    const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
    let lastErr = "";

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: prompt },
                  { inline_data: { mime_type: mimeType, data: imageBase64 } },
                ],
              }],
              generationConfig: { temperature: 0, maxOutputTokens: 4000 },
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeout);
        if (!res.ok) { lastErr = `${model} ${res.status}`; continue; }

        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!text) { lastErr = `${model}: 빈 응답`; continue; }

        return NextResponse.json({ text });
      } catch (err) {
        lastErr = `${model}: ${err.name === "AbortError" ? "타임아웃" : err.message}`;
        continue;
      }
    }

    return NextResponse.json({ error: lastErr }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
