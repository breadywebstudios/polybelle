import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return reply(405, { error: "Method not allowed." });

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply(401, { error: "Sign in as an admin before adding another admin." });

  let input: { email?: unknown; password?: unknown; action?: unknown };
  try {
    input = await request.json();
  } catch (error) {
    console.error("Invalid admin creation request body:", error);
    return reply(400, { error: "A valid JSON request is required." });
  }
  if (!input || typeof input !== "object") return reply(400, { error: "A valid JSON request is required." });

  // "create" (default): new admin login + allowlist. "set_password": new password for an existing Polybelle admin.
  const action = input.action === "set_password" ? "set_password" : "create";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return reply(400, { error: "Enter a valid email address." });
  }
  if (password.length < 8) return reply(400, { error: "Use a password with at least 8 characters." });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing Supabase environment variables for admin creation.");
    return reply(500, { error: "Admin account creation is not configured on the server." });
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: authData, error: authError } = await callerClient.auth.getUser(token);
  if (authError || !authData.user) return reply(401, { error: "Your admin session is invalid. Sign in again." });

  const { data: isAdmin, error: adminCheckError } = await callerClient.rpc("pb_is_admin");
  if (adminCheckError) {
    console.error("Could not verify admin permissions:", adminCheckError.message);
    return reply(500, { error: "Could not verify admin permissions." });
  }
  if (!isAdmin) return reply(403, { error: "Admin access is required to manage admins." });

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  if (action === "set_password") {
    if (email === (authData.user.email || "").toLowerCase()) {
      return reply(400, { error: "To change your own password, use “Change my password”." });
    }
    // Only logins on the Polybelle admin list can be changed here (the login system is shared with other sites).
    const { data: userId, error: lookupUserError } = await serviceClient.rpc("pb_admin_auth_user_id", { p_email: email });
    if (lookupUserError) {
      console.error("Could not look up admin login:", lookupUserError.message);
      return reply(500, { error: "Could not look up this admin's login." });
    }
    if (!userId) return reply(404, { error: "That email is not a Polybelle admin with a login." });
    const { error: updateError } = await serviceClient.auth.admin.updateUserById(userId, { password });
    if (updateError) {
      console.error("Could not set admin password:", updateError.message);
      return reply(400, { error: updateError.message });
    }
    return reply(200, { success: true, email, action });
  }

  const { data: existingAdmin, error: lookupError } = await callerClient
    .from("pb_admins")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  if (lookupError) {
    console.error("Could not check existing admin access:", lookupError.message);
    return reply(500, { error: "Could not check whether this email is already an admin." });
  }

  const { data: created, error: createError } = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true
  });
  if (createError || !created.user) {
    console.error("Could not create admin auth account:", createError?.message);
    const message = createError?.message.toLowerCase().includes("already")
      ? "An account with this email already exists. This form only creates new accounts and will not change an existing password."
      : createError?.message || "Supabase did not return the new account.";
    return reply(400, { error: message });
  }

  const { error: allowlistError } = existingAdmin
    ? { error: null }
    : await serviceClient.from("pb_admins").insert({ email });
  if (allowlistError) {
    const { error: rollbackError } = await serviceClient.auth.admin.deleteUser(created.user.id);
    console.error("Could not grant admin access:", allowlistError.message);
    if (rollbackError) console.error("Could not remove the unlisted auth account:", rollbackError.message);
    return reply(500, {
      error: rollbackError
        ? "The account was created, but admin access could not be granted or rolled back. Contact support."
        : "The account could not be added to the admin list; its new login was removed."
    });
  }

  return reply(200, { success: true, email });
});
