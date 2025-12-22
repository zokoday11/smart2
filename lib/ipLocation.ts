// lib/ipLocation.ts
// Récupère IP + pays + ville côté client, avec un petit cache en sessionStorage

export type ClientLocation = {
  ip: string | null;
  country: string | null;
  city: string | null;
};

let inMemoryLocation: ClientLocation | null = null;
let inFlightPromise: Promise<ClientLocation | null> | null = null;

function loadFromSession(): ClientLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem("smartcv_location_cache");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "ip" in parsed &&
      "country" in parsed &&
      "city" in parsed
    ) {
      return parsed as ClientLocation;
    }
  } catch {
    // ignore
  }
  return null;
}

function saveToSession(loc: ClientLocation) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      "smartcv_location_cache",
      JSON.stringify(loc)
    );
  } catch {
    // ignore
  }
}

export async function getClientLocation(): Promise<ClientLocation | null> {
  if (typeof window === "undefined") return null;

  if (inMemoryLocation) return inMemoryLocation;

  const cached = loadFromSession();
  if (cached) {
    inMemoryLocation = cached;
    return cached;
  }

  if (inFlightPromise) return inFlightPromise;

  inFlightPromise = (async () => {
    try {
      const res = await fetch("https://ipapi.co/json/");
      if (!res.ok) throw new Error("IP API error");
      const data = await res.json();

      const loc: ClientLocation = {
        ip: data.ip || null,
        country: data.country_name || data.country || null,
        city: data.city || null,
      };

      inMemoryLocation = loc;
      saveToSession(loc);
      return loc;
    } catch (e) {
      console.error("Erreur getClientLocation:", e);
      const loc: ClientLocation = {
        ip: null,
        country: null,
        city: null,
      };
      inMemoryLocation = loc;
      saveToSession(loc);
      return loc;
    }
  })();

  return inFlightPromise;
}
