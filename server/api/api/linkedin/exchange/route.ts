// app/api/linkedin/exchange/route.ts
import { NextRequest, NextResponse } from "next/server";
import qs from "querystring";

// ⚠️ Mets ces valeurs dans .env.local (voir plus bas)
const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID!;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET!;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI!; // doit matcher l'URL callback

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();

    if (!code) {
      return NextResponse.json(
        { error: "Missing authorization code" },
        { status: 400 }
      );
    }

    // 1) Échanger le code contre un access_token + id_token
    const tokenResp = await fetch(
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: qs.stringify({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET
        })
      }
    );

    if (!tokenResp.ok) {
      const text = await tokenResp.text();
      console.error("LinkedIn token error:", text);
      return NextResponse.json(
        { error: "Failed to exchange code", details: text },
        { status: 400 }
      );
    }

    const tokenJson = (await tokenResp.json()) as any;

    // LinkedIn peut renvoyer un id_token si on a demandé scope "openid"
    const idToken = tokenJson.id_token;
    const accessToken = tokenJson.access_token;

    if (!idToken) {
      // On peut continuer avec accessToken si besoin, mais pour Firebase OIDC,
      // on veut surtout un id_token. Si pas dispo, renvoie erreur claire.
      return NextResponse.json(
        {
          error:
            "LinkedIn n'a pas renvoyé d'id_token (vérifie que le scope openid est bien activé)"
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ idToken, accessToken });
  } catch (e: any) {
    console.error("LinkedIn exchange error:", e);
    return NextResponse.json(
      { error: "Server error", details: e.message },
      { status: 500 }
    );
  }
}
