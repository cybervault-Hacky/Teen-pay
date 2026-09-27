import { Suspense } from "react";
import { AuthStatusScreen } from "@/components/auth/auth-status-screen";
import { SignInScreen } from "@/components/auth/sign-in-screen";

export const metadata = {
  title: "Sign in",
  description: "Open a sandbox session as a teen or parent.",
};

export default function SignInPage() {
  return (
    <Suspense fallback={<AuthStatusScreen message="Loading…" />}>
      <SignInScreen />
    </Suspense>
  );
}
