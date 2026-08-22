import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getAuthUser } from "@/lib/auth-helper";
import { getSafeRedirect } from "@/lib/safe-redirect";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in · Roundtable Finance",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect?: string | string[] }>;
}) {
  const sp = await searchParams;
  const rawRedirect = Array.isArray(sp.redirect) ? sp.redirect[0] : sp.redirect;
  const redirectTo = getSafeRedirect(rawRedirect, "/dashboard");

  // Already signed in → skip the form.
  const user = await getAuthUser();
  if (user) redirect(redirectTo);

  return (
    <main className="flex min-h-svh flex-1 items-center justify-center p-6">
      <LoginForm redirectTo={redirectTo} />
    </main>
  );
}
