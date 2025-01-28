"use server";

import { createClient } from "@/supabase/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export async function loginWithSpotify() {
  const supabase = await createClient();
  const origin = (await headers()).get("origin");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "spotify",
    options: {
      scopes:
        "user-read-private user-read-email user-library-read playlist-modify-publics",
      redirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    console.error("Auth error:", error);
    return;
  }

  if (data.url) {
    redirect(data.url);
  }
}
