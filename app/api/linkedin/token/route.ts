// app/api/linkedin/token/route.ts
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { code } = await req.json();

    if (!code) {
      return NextResponse.json(
        { error: "code manquant" },
        { status: 400 }
      );
    }

    const clientId = process.env.LINKEDIN_CLIENT_ID!;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI!;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    // Appel LinkedIn pour échanger le code
    const resp = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const data = await resp.json();

    if (!resp.ok) {
      console.error("LinkedIn token error:", data);
      return NextResponse.json(
        { error: "Erreur LinkedIn", details: data },
        { status: 400 }
      );
    }

    // Avec le scope "openid", LinkedIn peut renvoyer un id_token
    const idToken = (data as any).id_token;

    if (!idToken) {
      return NextResponse.json(
        {
          error:
            "id_token manquant dans la réponse LinkedIn. Vérifie que le scope 'openid' est bien activé.",
          details: data,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({ idToken });
  } catch (e: any) {
    console.error("API /api/linkedin/token error:", e);
    return NextResponse.json(
      { error: e.message ?? "Erreur serveur" },
      { status: 500 }
    );
  }
}
