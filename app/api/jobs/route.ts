// app/api/jobs/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

// Clés Adzuna côté serveur Next
const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;

// Base CF pour vérifier reCAPTCHA côté serveur (anti-bypass)
const DEFAULT_API_BASE =
  "https://europe-west1-assistant-ia-v4.cloudfunctions.net";
const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  process.env.API_BASE_URL ||
  DEFAULT_API_BASE
).replace(/\/+$/, "");

async function verifyRecaptchaServer(token: string, action: string) {
  const res = await fetch(`${API_BASE}/recaptchaVerify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, action: (action || "").trim().toLowerCase() }),
    cache: "no-store",
  });

  const data: any = await res.json().catch(() => ({}));
  return { ok: res.ok && data?.ok === true, data };
}

type AdzunaRawJob = {
  id?: string;
  title?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url?: string;
  description?: string;
  created?: string;
  salary_min?: number;
  salary_max?: number;
};

type AdzunaRawResponse = {
  results?: AdzunaRawJob[];
  count?: number;
  mean?: number;
};

const ALLOWED_COUNTRIES = new Set([
  "fr",
  "be",
  "ch",
  "ca",
  "gb",
  "es",
  "de",
  "it",
]);

function asNumber(v: any): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      query,
      location,
      country = "fr",
      page = 1,
      results_per_page = 50,

      // Filtres optionnels (front)
      contract_time, // "any" | "full_time" | "part_time"
      contract_type, // "any" | "permanent" | "contract"
      salary_min,
      salary_max,
      max_days_old,

      recaptchaToken,
    } = body || {};

    // ✅ reCAPTCHA (anti-bypass)
    const check = await verifyRecaptchaServer(
      String(recaptchaToken || ""),
      "jobs_search"
    );
    if (!check.ok) {
      return NextResponse.json(
        { error: "reCAPTCHA refusé", details: check.data },
        { status: 403 }
      );
    }

    if (!query && !location) {
      return NextResponse.json(
        { error: "query ou location requis" },
        { status: 400 }
      );
    }

    if (!ADZUNA_APP_ID || !ADZUNA_APP_KEY) {
      console.error("ADZUNA_APP_ID ou ADZUNA_APP_KEY manquants");
      return NextResponse.json(
        {
          error:
            "Clés Adzuna non configurées côté serveur. Ajoute ADZUNA_APP_ID et ADZUNA_APP_KEY dans ton .env.local.",
        },
        { status: 500 }
      );
    }

    const safeCountry = String(country || "fr").toLowerCase().trim();
    const countryCode = ALLOWED_COUNTRIES.has(safeCountry) ? safeCountry : "fr";

    const safePage = asNumber(page) && (page as number) > 0 ? Number(page) : 1;

    const rppRaw = asNumber(results_per_page) ?? 50;
    const safeRpp = Math.max(1, Math.min(100, Math.floor(rppRaw)));

    const params = new URLSearchParams();
    params.set("app_id", ADZUNA_APP_ID);
    params.set("app_key", ADZUNA_APP_KEY);
    params.set("results_per_page", String(safeRpp));
    params.set("content-type", "application/json");

    if (query) params.set("what", String(query));
    if (location) params.set("where", String(location));

    // Filtres Adzuna
    const salMin = asNumber(salary_min);
    const salMax = asNumber(salary_max);
    const maxDays = asNumber(max_days_old);

    if (salMin !== undefined) params.set("salary_min", String(Math.floor(salMin)));
    if (salMax !== undefined) params.set("salary_max", String(Math.floor(salMax)));
    if (maxDays !== undefined) params.set("max_days_old", String(Math.floor(maxDays)));

    // contract_time
    if (contract_time === "full_time") params.set("full_time", "1");
    if (contract_time === "part_time") params.set("part_time", "1");

    // contract_type
    if (contract_type === "permanent") params.set("permanent", "1");
    if (contract_type === "contract") params.set("contract", "1");

    // URL
    const url = `https://api.adzuna.com/v1/api/jobs/${countryCode}/search/${safePage}?${params.toString()}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      const textErr = await resp.text();
      console.error("Erreur Adzuna:", resp.status, textErr);
      return NextResponse.json(
        { error: "Erreur lors de l'appel à l'API Adzuna." },
        { status: 500 }
      );
    }

    const data: AdzunaRawResponse = await resp.json();

    const jobs =
      (data.results || []).map((job, index) => ({
        id: job.id || `job-${safePage}-${index}`,
        title: job.title || "Offre sans titre",
        company: job.company?.display_name || "Entreprise non renseignée",
        location: job.location?.display_name || "Lieu non précisé",
        url: job.redirect_url || "",
        description: job.description || "",
        created: job.created || "",
        // ✅ important pour ton front (il calcule salary avec salary_min/max)
        salary_min: typeof job.salary_min === "number" ? job.salary_min : undefined,
        salary_max: typeof job.salary_max === "number" ? job.salary_max : undefined,
      })) || [];

    return NextResponse.json({
      jobs,
      meta: {
        country: countryCode,
        page: safePage,
        results_per_page: safeRpp,
        count: typeof data.count === "number" ? data.count : undefined,
      },
    });
  } catch (err) {
    console.error("Erreur /api/jobs:", err);
    return NextResponse.json(
      { error: "Erreur interne lors de la recherche d'offres (API jobs)." },
      { status: 500 }
    );
  }
}
