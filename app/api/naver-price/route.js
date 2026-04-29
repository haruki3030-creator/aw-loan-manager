import { NextResponse } from "next/server";

export const maxDuration = 25;

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  "Referer": "https://new.land.naver.com/",
  "Origin": "https://new.land.naver.com",
};

// "4억 5,000" → 45000 (만원), "12억" → 120000, "8,000" → 8000
function parsePrice(s) {
  if (!s) return 0;
  const cleaned = String(s).replace(/[,\s]/g, "");
  const m = cleaned.match(/^(?:(\d+)억)?(\d+)?$/);
  if (!m) return 0;
  const eok = m[1] ? parseInt(m[1]) * 10000 : 0;
  const man = m[2] ? parseInt(m[2]) : 0;
  return eok + man;
}

async function searchComplex(keyword) {
  // 단지 검색
  const url = `https://new.land.naver.com/api/search?keyword=${encodeURIComponent(keyword)}&siteOrigin=p`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`검색 실패 ${res.status}`);
  const data = await res.json();
  const complexes = data?.complexes || [];
  return complexes.map((c) => ({
    complexNo: c.complexNo,
    name: c.complexName,
    address: c.cortarAddress || c.exposureAddress || "",
    type: c.realEstateTypeName || "",
  }));
}

async function fetchArticles(complexNo, page = 1) {
  // 매매 매물
  const url = `https://new.land.naver.com/api/articles/complex/${complexNo}?realEstateType=APT&tradeType=A1&order=rank&page=${page}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`매물 조회 실패 ${res.status}`);
  const data = await res.json();
  return data?.articleList || [];
}

export async function POST(req) {
  try {
    const { keyword, targetArea, complexNo } = await req.json();
    if (!keyword && !complexNo) {
      return NextResponse.json({ error: "keyword 또는 complexNo 필수" }, { status: 400 });
    }

    let chosen = null;
    let candidates = [];
    if (complexNo) {
      chosen = { complexNo, name: keyword || "", address: "", type: "APT" };
    } else {
      candidates = await searchComplex(keyword);
      if (candidates.length === 0) {
        return NextResponse.json({ error: "단지를 찾을 수 없음", candidates: [] }, { status: 404 });
      }
      chosen = candidates[0];
    }

    // 매물 1~2페이지
    const [p1, p2] = await Promise.all([
      fetchArticles(chosen.complexNo, 1).catch(() => []),
      fetchArticles(chosen.complexNo, 2).catch(() => []),
    ]);
    const articles = [...p1, ...p2];

    const items = articles.map((a) => {
      const area2 = parseFloat(a.area2) || 0; // 전용면적
      const area1 = parseFloat(a.area1) || 0; // 공급면적
      return {
        articleNo: a.articleNo,
        name: a.articleName || a.buildingName || "",
        type: a.tradeTypeName || "",
        price: parsePrice(a.dealOrWarrantPrc),
        priceText: a.dealOrWarrantPrc || "",
        areaSupply: area1,
        areaExclu: area2,
        floor: a.floorInfo || "",
        confirmYmd: a.articleConfirmYmd || "",
        feature: a.articleFeatureDesc || "",
        tags: a.tagList || [],
        realtor: a.realtorName || "",
      };
    });

    // 면적 필터 (전용면적 ±2㎡)
    let matched = items;
    if (targetArea && targetArea > 0) {
      matched = items.filter((x) => x.areaExclu > 0 && Math.abs(x.areaExclu - targetArea) <= 2);
    }

    // 통계
    const prices = matched.filter((x) => x.price > 0).map((x) => x.price);
    const stats = prices.length > 0 ? {
      count: prices.length,
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    } : null;

    // 가격순 정렬 (낮은 가격이 위)
    matched.sort((a, b) => a.price - b.price);

    return NextResponse.json({
      complex: chosen,
      candidates: candidates.slice(0, 5),
      totalArticles: articles.length,
      matchedCount: matched.length,
      items: matched.slice(0, 30),
      stats,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
