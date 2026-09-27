import { AuthProvider } from "@/auth/provider";
import type { AuthService } from "@/auth/types";
import ActivityPage from "@/app/activity/page";
import CreateAccountPage from "@/app/create-account/page";
import FamilyPage from "@/app/family/page";
import MoneyPage from "@/app/money/page";
import NotFound from "@/app/not-found";
import HomePage from "@/app/page";
import ParentPage from "@/app/parent/page";
import PayPage from "@/app/pay/page";
import ProfilePage from "@/app/profile/page";
import SignInPage from "@/app/sign-in/page";
import { AppShell } from "@/components/layout/app-shell";
import { RoleGate } from "@/components/sandbox/role-gate";
import { SpaceDetail } from "@/components/spaces/space-detail";
import { SandboxProvider } from "@/sandbox/store";
import { usePathname } from "./router";

const PAGES: Record<string, () => React.ReactNode> = {
  "/": () => <HomePage />,
  "/pay": () => <PayPage />,
  "/money": () => <MoneyPage />,
  "/activity": () => <ActivityPage />,
  "/family": () => <FamilyPage />,
  "/parent": () => <ParentPage />,
  "/profile": () => <ProfilePage />,
  "/sign-in": () => <SignInPage />,
  "/create-account": () => <CreateAccountPage />,
};

/**
 * `/money/[spaceId]` — the real route is an async server component,
 * so tests render what it renders: the gated client detail.
 */
function dynamicPage(pathname: string): (() => React.ReactNode) | undefined {
  const space = /^\/money\/([^/]+)$/.exec(pathname);
  if (!space) return undefined;
  const spaceId = decodeURIComponent(space[1]!);
  return function SpacePage() {
    return (
      <RoleGate role="teen">
        <SpaceDetail spaceId={spaceId} />
      </RoleGate>
    );
  };
}

function Page() {
  const pathname = usePathname();
  const render = PAGES[pathname] ?? dynamicPage(pathname);
  return <>{render ? render() : <NotFound />}</>;
}

/** The real provider stack and shell, with the real page modules. */
export function TestApp({ service, now }: { service?: AuthService; now?: () => number }) {
  return (
    <AuthProvider service={service} now={now}>
      <SandboxProvider>
        <AppShell>
          <Page />
        </AppShell>
      </SandboxProvider>
    </AuthProvider>
  );
}
