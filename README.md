# 올웨더파트너스대부 — 물건접수 종합분석기

카톡 파싱 + 등기부 권리분석 + 카톡 발송양식 자동 생성

## 배포 방법 (5분)

### 1. GitHub에 올리기
```bash
cd aw-app
git init
git add .
git commit -m "물건접수 종합분석기"
git remote add origin https://github.com/YOUR_USERNAME/aw-loan-manager.git
git push -u origin main
```

### 2. Vercel 배포
1. [vercel.com](https://vercel.com) 접속 → GitHub로 로그인
2. "Import Project" → 위에서 만든 repo 선택
3. Environment Variables 추가:
   - `GEMINI_API_KEY` = Google AI Studio에서 발급한 키
4. Deploy 클릭

### 3. Gemini API Key 발급
1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) 접속
2. "Create API Key" 클릭
3. 발급된 키를 Vercel 환경변수에 입력

### 4. 팀원 접속
- 배포 완료 후 `https://aw-loan-manager.vercel.app` 같은 주소가 생김
- 팀원들에게 공유하면 바로 사용 가능
- API Key는 서버에서 관리되므로 팀원에게 노출 안 됨

## 기능

### 접수입력
- 카톡 메시지 붙여넣기 (아무 형식)
- 등기부 PDF 업로드 (선택)
- 🤖 AI 종합 분석 / ⚡ 빠른 분석(정규식) 선택

### 검토수정
- 카톡 + 등기부 자동 병합 결과 확인/수정
- 🤖 등기부 위험사항 분석 (AI)
  - 갑구: 가압류/가처분/경매 말소 여부
  - 을구: 근저당 현황 + LTV
  - 종합: 후순위 취급 가능 여부

### 발송양식
- 올웨더파트너스 브랜딩 카톡 양식 생성
- 클립보드 복사 → 카톡에 바로 붙여넣기
