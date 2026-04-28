import { NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req) {
  try {
    const { text } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY 미설정" }, { status: 500 });
    }

    const prompt = `카톡에서 대출 물건 정보 추출. JSON만. 코드블록 금지.
{"type":"","rank":"","loanType":"","name":"","birth":"","phone":"","address":"","kb":"","senior":"","seniorDetail":"","amount":"","job":"","salary":"","credit":"","purpose":"","period":"","special":"","note":""}
없으면 빈문자열.
카톡:
${text.slice(0, 1500)}`;

    const models = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
    let lastErr = "";

    for (const model of models) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 1000 },
            }),
            signal: controller.signal,
          }
        );

        clearTimeout(timeout);

        if (!res.ok) {
          lastErr = `${model} ${res.status}`;
          continue;
        }

        const data = await res.json();
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!aiText) { lastErr = `${model}: 빈 응답`; continue; }

        const cleaned = aiText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        const jsonM = cleaned.match(/\{[\s\S]*\}/);
        if (!jsonM) {
          return NextResponse.json({ error: "JSON 추출 실패" }, { status: 500 });
        }

        const parsed = JSON.parse(jsonM[0]);
        return NextResponse.json({ result: parsed });

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
