// 슬기로운 배구생활 통합 API (sv-api)
// - 회원 명단: vball_trainees (AI 동작 분석 앱과 공유, batch '강사' = 강사 계정)
// - AI 동작 분석 기능 ON/OFF: vball_config(마스터) + vball_batch_config(기수) + vball_trainees.enabled_override(개인)
// - 희망 조사 / 영상 자료실 ON/OFF: sv_features
// 모든 요청: POST { action, ... }  /  인증: Authorization: Bearer <token>
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
const fail = (message: string, s = 400) => json({ ok: false, message }, s);

const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE_KEY, { auth: { persistSession: false } });
const SECRET = Deno.env.get("SV_TOKEN_SECRET") || SERVICE_KEY;
const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "";

const INSTRUCTOR = "강사";
const USER_HOURS = 12, ADMIN_HOURS = 6, MAX_FAIL = 5, LOCK_MIN = 10;
const FEATURES = ["survey", "ai", "videos"] as const;
const PARTS = ["리시브", "수비", "공격", "세터(토스)"];
const POS = ["레프트", "세터", "라이트", "센터(속공)", "앞차", "백차", "레프트백", "센터백", "라이트백"];
const today = () => new Date(Date.now() + 9 * 36e5).toISOString().slice(0, 10); // KST
const within = (ends?: string | null) => !ends || today() <= ends;
const okDate = (x: unknown) => x === "" || x == null || /^\d{4}-\d{2}-\d{2}$/.test(String(x));
const str = (x: unknown, n = 200) => String(x ?? "").trim().slice(0, n);

/* ---------------- 토큰 (HMAC-SHA256) ---------------- */
const enc = new TextEncoder();
let keyP: Promise<CryptoKey> | null = null;
const hkey = () => keyP ??= crypto.subtle.importKey("raw", enc.encode("sv:" + SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
async function sign(p: string) { return b64u(await crypto.subtle.sign("HMAC", await hkey(), enc.encode(p))); }
type Tok = { r: "t" | "i" | "a"; id: number | null; n: string; e: number };
async function issue(t: Omit<Tok, "e">, hours: number) {
  const p = b64u(enc.encode(JSON.stringify({ ...t, e: Date.now() + hours * 36e5 })));
  return `${p}.${await sign(p)}`;
}
async function readToken(req: Request): Promise<Tok | null> {
  const [p, s] = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").split(".");
  if (!p || !s) return null;
  const good = await sign(p);
  if (good.length !== s.length) return null;
  let diff = 0; for (let i = 0; i < s.length; i++) diff |= good.charCodeAt(i) ^ s.charCodeAt(i);
  if (diff) return null;
  try {
    const o = JSON.parse(decodeURIComponent(escape(unb64u(p)))) as Tok;
    return o.e > Date.now() ? o : null;
  } catch { return null; }
}

/* ---------------- 잠금 ---------------- */
async function lockState(key: string) {
  const { data } = await db.from("sv_login_lock").select("*").eq("key", key).maybeSingle();
  return data as { fails: number; locked_until: string | null } | null;
}
async function addFail(key: string) {
  const l = await lockState(key);
  const fails = (l?.fails || 0) + 1;
  await db.from("sv_login_lock").upsert(fails >= MAX_FAIL
    ? { key, fails: 0, locked_until: new Date(Date.now() + LOCK_MIN * 6e4).toISOString() }
    : { key, fails, locked_until: null });
}
const clearFail = (key: string) => db.from("sv_login_lock").upsert({ key, fails: 0, locked_until: null });

/* ---------------- 사용자 / 기능 권한 ---------------- */
type Trainee = { id: number; name: string; code: string; batch: string; active: boolean; enabled_override: boolean | null };
const pub = (t: Trainee) => ({ id: t.id, name: t.name, batch: t.batch || "1기", role: t.batch === INSTRUCTOR ? "instructor" : "trainee" });

async function featureMap(t: Trainee | null, role: string) {
  if (role !== "trainee") return { survey: true, ai: role === "instructor", videos: true };
  const batch = t!.batch || "1기";
  const [{ data: sf }, { data: master }, { data: bc }] = await Promise.all([
    db.from("sv_features").select("*").eq("batch", batch),
    db.from("vball_config").select("*").eq("id", 1).maybeSingle(),
    db.from("vball_batch_config").select("*").eq("batch", batch).maybeSingle(),
  ]);
  const f = (k: string) => { const r = (sf || []).find((x: any) => x.feature === k); return !!r && r.enabled && within(r.ends); };
  let ai = !!(master ? master.enabled && within(master.active_until) : true);
  if (ai) {
    if (t!.enabled_override === true) ai = true;
    else if (t!.enabled_override === false) ai = false;
    else ai = bc ? !!bc.enabled && within(bc.active_until) : true;
  }
  return { survey: f("survey"), ai, videos: f("videos") };
}

async function getTrainee(id: number) {
  const { data } = await db.from("vball_trainees").select("id,name,code,batch,active,enabled_override").eq("id", id).maybeSingle();
  return data as Trainee | null;
}
// 토큰 확인 + DB 재확인 (비활성화 즉시 반영)
async function auth(req: Request) {
  const t = await readToken(req);
  if (!t) return null;
  if (t.r === "a") return { tok: t, trainee: null, role: "admin" as const };
  const tr = await getTrainee(t.id!);
  if (!tr || !tr.active) return null;
  return { tok: t, trainee: tr, role: tr.batch === INSTRUCTOR ? "instructor" as const : "trainee" as const };
}
async function surveyDone(id: number | null) {
  if (!id) return false;
  const { count } = await db.from("sv_survey").select("trainee_id", { count: "exact", head: true }).eq("trainee_id", id);
  return (count || 0) > 0;
}
async function notice() {
  const { data } = await db.from("sv_config").select("value").eq("key", "notice").maybeSingle();
  return typeof data?.value === "string" ? data.value : "";
}

/* ---------------- 핸들러 ---------------- */
async function login(b: any) {
  const name = str(b.name, 30), code = str(b.code, 30);
  if (!name || !code) return fail("이름과 개인확인코드를 입력해 주세요.");
  const lk = "u:" + name.toLowerCase();
  const l = await lockState(lk);
  if (l?.locked_until && new Date(l.locked_until).getTime() > Date.now())
    return fail(`시도 횟수를 초과했어요. ${Math.ceil((new Date(l.locked_until).getTime() - Date.now()) / 6e4)}분 후 다시 시도해 주세요.`, 429);
  const { data } = await db.from("vball_trainees").select("id,name,code,batch,active,enabled_override").ilike("name", name).eq("code", code);
  const t = (data || []).find((r: Trainee) => r.name.trim().toLowerCase() === name.toLowerCase()) as Trainee | undefined;
  if (!t) { await addFail(lk); return fail("이름 또는 개인확인코드가 일치하지 않아요.", 401); }
  if (!t.active) return fail("사용이 중지된 계정이에요. 강사님께 문의해 주세요.", 403);
  await clearFail(lk);
  const u = pub(t);
  const token = await issue({ r: u.role === "instructor" ? "i" : "t", id: t.id, n: t.name }, USER_HOURS);
  return json({ ok: true, token, user: u, features: await featureMap(t, u.role), notice: await notice(), survey_done: await surveyDone(t.id) });
}

async function adminLogin(b: any) {
  const lk = "admin";
  const l = await lockState(lk);
  if (l?.locked_until && new Date(l.locked_until).getTime() > Date.now()) return fail("시도 횟수를 초과했어요. 잠시 후 다시 시도해 주세요.", 429);
  if (!ADMIN_PASSWORD || str(b.password, 200) !== ADMIN_PASSWORD) { await addFail(lk); return fail("비밀번호가 올바르지 않아요.", 401); }
  await clearFail(lk);
  return json({ ok: true, token: await issue({ r: "a", id: null, n: "관리자" }, ADMIN_HOURS), user: { id: null, name: "관리자", batch: "", role: "admin" } });
}

async function surveyGet(me: Trainee) {
  const { data } = await db.from("sv_survey").select("*").eq("trainee_id", me.id).maybeSingle();
  return json({ ok: true, survey: data || null, parts: PARTS, positions: POS });
}
async function surveySave(me: Trainee, b: any) {
  const part = str(b.part, 20);
  if (!PARTS.includes(part)) return fail("연습하고 싶은 파트를 하나 골라 주세요.");
  const positions = (Array.isArray(b.positions) ? b.positions : []).map(String).filter((p: string) => POS.includes(p));
  const row = { trainee_id: me.id, part, memo: str(b.memo, 1000), positions: [...new Set(positions)], updated_at: new Date().toISOString() };
  const { error } = await db.from("sv_survey").upsert(row);
  if (error) return fail("저장하지 못했어요.", 500);
  return json({ ok: true, survey: row });
}

async function videosList(batch: string | null) {
  const { data } = await db.from("sv_videos").select("*").order("date", { ascending: false }).limit(300);
  const list = (data || []).filter((v: any) => !batch || !v.batches?.length || v.batches.includes(batch));
  return json({ ok: true, videos: list.map((v: any) => ({ video_id: v.video_id, title: v.title, date: v.date, category: v.category, players: v.players || [] })) });
}

/* ---------------- 관리자 ---------------- */
async function batchList() {
  const { data } = await db.from("vball_trainees").select("batch");
  const s = new Set(["1기", "2기"]);
  (data || []).forEach((r: any) => r.batch && r.batch !== INSTRUCTOR && s.add(r.batch));
  return [...s].sort((a, b) => a.localeCompare(b, "ko", { numeric: true }));
}
async function adminData() {
  const [{ data: tr }, batches, { data: sf }, { data: bc }, { data: master }, nt] = await Promise.all([
    db.from("vball_trainees").select("id,name,code,batch,active,enabled_override,created_at").order("name"),
    batchList(),
    db.from("sv_features").select("*"),
    db.from("vball_batch_config").select("*"),
    db.from("vball_config").select("*").eq("id", 1).maybeSingle(),
    notice(),
  ]);
  const grid = batches.map((batch) => {
    const g = (k: string) => { const r = (sf || []).find((x: any) => x.batch === batch && x.feature === k); return { enabled: !!r?.enabled, ends: r?.ends || "" }; };
    const a = (bc || []).find((x: any) => x.batch === batch);
    return { batch, survey: g("survey"), videos: g("videos"), ai: { enabled: a ? !!a.enabled : true, ends: a?.active_until || "" } };
  });
  return json({ ok: true, trainees: tr || [], batches, features: grid, ai_master: master || { enabled: true }, notice: nt });
}

async function featureSave(b: any) {
  const batch = str(b.batch, 20), feature = str(b.feature, 10);
  if (!batch || batch === INSTRUCTOR || !FEATURES.includes(feature as any)) return fail("기수와 기능을 확인해 주세요.");
  if (!okDate(b.ends)) return fail("날짜 형식이 올바르지 않아요.");
  const ends = b.ends || null, enabled = b.enabled === true, now = new Date().toISOString();
  const { error } = feature === "ai"
    ? await db.from("vball_batch_config").upsert({ batch, enabled, active_until: ends, updated_at: now })
    : await db.from("sv_features").upsert({ batch, feature, enabled, ends, updated_at: now });
  return error ? fail("저장하지 못했어요: " + error.message, 500) : json({ ok: true });
}

async function aiMasterSave(b: any) {
  if (!okDate(b.active_until)) return fail("날짜 형식이 올바르지 않아요.");
  const patch: Record<string, unknown> = { enabled: b.enabled === true, active_until: b.active_until || null, message: str(b.message, 300) || null, updated_at: new Date().toISOString() };
  if ("training_start_date" in b) { if (!okDate(b.training_start_date)) return fail("날짜 형식이 올바르지 않아요."); patch.training_start_date = b.training_start_date || null; }
  const { error } = await db.from("vball_config").update(patch).eq("id", 1);
  return error ? fail("저장하지 못했어요.", 500) : json({ ok: true });
}

function cleanTrainee(r: any) {
  const name = str(r.name, 30), code = str(r.code, 30), batch = str(r.batch, 20) || "1기";
  if (!name || !code) return { err: "이름 또는 코드 없음" };
  const ov = r.enabled_override === true ? true : r.enabled_override === false ? false : null;
  return { row: { name, code, batch, active: r.active !== false, enabled_override: ov } };
}
async function traineeSave(b: any) {
  const c = cleanTrainee(b);
  if (c.err) return fail("이름과 개인확인코드를 입력해 주세요.");
  const row = c.row!;
  // 같은 이름+코드 중복 방지
  const { data: dup } = await db.from("vball_trainees").select("id").ilike("name", row.name).eq("code", row.code);
  if ((dup || []).some((d: any) => d.id !== Number(b.id))) return fail("같은 이름과 코드를 가진 사람이 이미 있어요. 코드를 바꿔 주세요.", 409);
  const q = b.id ? db.from("vball_trainees").update(row).eq("id", Number(b.id)) : db.from("vball_trainees").insert(row);
  const { error } = await q;
  return error ? fail("저장하지 못했어요: " + error.message, 500) : json({ ok: true });
}
async function traineeBulk(b: any) {
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 500) : [];
  const skip = b.mode === "skip";
  const { data: all } = await db.from("vball_trainees").select("id,name");
  const byName = new Map((all || []).map((r: any) => [r.name.trim().toLowerCase(), r.id]));
  let created = 0, updated = 0, skipped = 0, rejected = 0;
  const ins: any[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const c = cleanTrainee(r);
    if (c.err) { rejected++; continue; }
    const k = c.row!.name.toLowerCase();
    if (seen.has(k)) { rejected++; continue; }
    seen.add(k);
    const id = byName.get(k);
    if (id) {
      if (skip) { skipped++; continue; }
      const { enabled_override: _o, ...rest } = c.row!;
      const { error } = await db.from("vball_trainees").update(rest).eq("id", id);
      error ? rejected++ : updated++;
    } else ins.push(c.row);
  }
  if (ins.length) {
    const { error } = await db.from("vball_trainees").insert(ins);
    if (error) return fail("일부 등록에 실패했어요: " + error.message, 500);
    created = ins.length;
  }
  return json({ ok: true, created, updated, skipped, rejected });
}

async function surveyList() {
  const [{ data: s }, { data: t }] = await Promise.all([
    db.from("sv_survey").select("*"),
    db.from("vball_trainees").select("id,name,batch,active").neq("batch", INSTRUCTOR).order("name"),
  ]);
  const by = new Map((s || []).map((r: any) => [r.trainee_id, r]));
  return json({ ok: true, parts: PARTS, positions: POS, rows: (t || []).map((x: any) => ({ ...x, survey: by.get(x.id) || null })) });
}

async function videoSave(b: any) {
  const video_id = str(b.video_id, 20);
  if (!/^[\w-]{6,20}$/.test(video_id) || !str(b.title) || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || "")) return fail("영상 주소, 제목, 날짜를 확인해 주세요.");
  const arr = (x: unknown) => (Array.isArray(x) ? x : []).map((s) => str(s, 30)).filter(Boolean);
  const row = { video_id, title: str(b.title), date: b.date, category: str(b.category, 20) || "수업", batches: arr(b.batches), players: arr(b.players) };
  const { error } = b.id ? await db.from("sv_videos").update(row).eq("id", Number(b.id)) : await db.from("sv_videos").insert(row);
  return error ? fail("저장하지 못했어요: " + error.message, 500) : json({ ok: true });
}

/* ---------------- 라우터 ---------------- */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return fail("POST 요청만 받아요.", 405);
  try {
    const b = await req.json().catch(() => ({}));
    const a = String(b.action || "");
    if (a === "login") return await login(b);
    if (a === "admin_login") return await adminLogin(b);

    const s = await auth(req);
    if (!s) return fail("로그인이 필요해요.", 401);
    const feats = await featureMap(s.trainee, s.role);
    const need = (k: keyof typeof feats) => feats[k] || s.role !== "trainee" ? null : fail("지금은 열려 있지 않은 기능이에요.", 403);

    if (a === "me") return json({ ok: true, user: s.trainee ? pub(s.trainee) : { id: null, name: "관리자", batch: "", role: "admin" }, features: feats, notice: await notice(), survey_done: await surveyDone(s.trainee?.id ?? null) });
    if (a === "survey_get") { if (!s.trainee) return fail("연수생 계정으로 이용해 주세요."); return need("survey") || await surveyGet(s.trainee); }
    if (a === "survey_save") { if (!s.trainee) return fail("연수생 계정으로 이용해 주세요."); return need("survey") || await surveySave(s.trainee, b); }
    if (a === "videos") return need("videos") || await videosList(s.role === "trainee" ? s.trainee!.batch : null);
    if (a === "video_log") {
      await db.from("sv_video_logs").insert({ trainee_id: s.trainee?.id ?? null, name: s.tok.n, video_id: str(b.video_id, 20) });
      return json({ ok: true });
    }

    if (a.startsWith("admin_")) {
      if (s.role === "trainee") return fail("강사만 사용할 수 있어요.", 403);
      if (a === "admin_data") return await adminData();
      if (a === "admin_feature") return await featureSave(b);
      if (a === "admin_ai_master") return await aiMasterSave(b);
      if (a === "admin_trainee") return await traineeSave(b);
      if (a === "admin_trainee_bulk") return await traineeBulk(b);
      if (a === "admin_trainee_delete") {
        if (s.trainee && Number(b.id) === s.trainee.id) return fail("본인 계정은 삭제할 수 없어요.");
        await db.from("sv_survey").delete().eq("trainee_id", Number(b.id));
        const { error } = await db.from("vball_trainees").delete().eq("id", Number(b.id));
        return error ? fail("삭제하지 못했어요.", 500) : json({ ok: true });
      }
      if (a === "admin_survey") return await surveyList();
      if (a === "admin_videos") {
        const { data } = await db.from("sv_videos").select("*").order("date", { ascending: false });
        return json({ ok: true, videos: data || [] });
      }
      if (a === "admin_video") return await videoSave(b);
      if (a === "admin_video_delete") { await db.from("sv_videos").delete().eq("id", Number(b.id)); return json({ ok: true }); }
      if (a === "admin_logs") {
        const { data } = await db.from("sv_video_logs").select("*").order("at", { ascending: false }).limit(500);
        return json({ ok: true, logs: data || [] });
      }
      if (a === "admin_notice") {
        await db.from("sv_config").upsert({ key: "notice", value: str(b.text, 300) });
        return json({ ok: true });
      }
    }
    return fail("알 수 없는 요청이에요.", 404);
  } catch (e) {
    console.error(e);
    return fail("서버 오류: " + String((e as Error)?.message || e).slice(0, 200), 500);
  }
});
