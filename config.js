// 슬기로운 배구생활 통합 앱 공통 설정
// 서버(Supabase) 주소를 바꾸려면 이 파일만 고치면 됩니다.
window.SV_CONFIG = {
  API_URL: "https://pqjuvuflinnrpemqcafl.supabase.co/functions/v1/sv-api",
  TITLE: "슬기로운 배구생활",
  SUBTITLE: "겨울방학 배구 연수",
};

// 공통 API 호출 (토큰 자동 첨부, 401이면 로그인 화면으로)
window.svApi = async function (action, body = {}, opts = {}) {
  const token = opts.token !== undefined ? opts.token : localStorage.getItem(opts.admin ? "sv_admin_token" : "sv_token");
  let r;
  try {
    r = await fetch(SV_CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: JSON.stringify({ action, ...body }),
    });
  } catch {
    return { ok: false, message: "인터넷 연결을 확인해 주세요." };
  }
  const d = await r.json().catch(() => ({ ok: false, message: "서버 응답을 읽지 못했어요." }));
  d.status = r.status;
  if (r.status === 401 && !["login", "admin_login"].includes(action) && opts.onAuthFail) opts.onAuthFail();
  return d;
};
