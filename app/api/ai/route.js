import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { text } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "GEMINI_API_KEY 환경변수가 설정되지 않았습니다" }, { status: 500 });
    }

    const prompt = `대부업 물건 접수 카톡 메시지에서 정보를 추출해. JSON만 반환해. 마크다운 코드블록 쓰지 마. 순수 JSON만.

{
  "type": "아파트/오피스텔/빌라·다세대/단독·다가구/상가/토지/기타 중 하나",
  "rank": "1순위/2순위/3순위",
  "loanType": "일반담보/분양담보/후순위/동시설정/대환/매매잔금/기타 중 하나",
  "name": "이름/성명/분양자/차주",
  "birth": "생년월일 (주민번호 앞자리-뒷자리 첫숫자 포함)",
  "phone": "연락처",
  "address": "담보물 주소 (최대한 상세하게)",
  "kb": "KB시세 또는 대체시세. KB 미등재 시 하우스머치/부동산114 등 포함. 예: KB 51000만, KB 미등재 / 하우스머치 43600만",
  "senior": "선순위 합계 요약",
  "seniorDetail": "금융사별 기대출 상세. 채권최고액/대출잔액 구분. 여러건이면 줄바꿈",
  "amount": "차주가 원하는 필요자금/요청금액. '최대 요청', '2순위 가능사 확인 부탁' 같은 텍스트도 포함",
  "job": "직업 (4대 직장인, 개인사업자 등 구체적으로)",
  "salary": "월소득/급여",
  "credit": "신용점수 (KCB/NICE 구분 포함)",
  "purpose": "자금용도 (대환, 생활자금, 잔금 등)",
  "period": "이용기간",
  "special": "특이사항 (대환사유, 괄호 안 메모, 중요 맥락)",
  "note": "부가정보 (전용면적, 세대수, 층수, 분양가, 실거래가, 신탁, 환매특약 등)"
}
없는 항목은 빈 문자열 ""로.

카톡 메시지:
${text}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2000 },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Gemini API ${res.status}: ${errText.slice(0, 200)}` }, { status: 500 });
    }

    const data = await res.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!aiText) {
      return NextResponse.json({ error: "Gemini 빈 응답" }, { status: 500 });
    }

    // JSON 추출
    const cleaned = aiText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const jsonM = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonM) {
      return NextResponse.json({ error: "JSON 추출 실패", raw: aiText.slice(0, 300) }, { status: 500 });
    }

    const parsed = JSON.parse(jsonM[0]);
    return NextResponse.json({ result: parsed });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
